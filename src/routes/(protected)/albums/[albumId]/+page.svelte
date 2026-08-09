<script module lang="ts">
	import type { PickedMedia } from "$lib/platform/media-picker";

	export function selectAlbumMedia({
		existingContentTypes,
		picked,
		remaining,
	}: {
		existingContentTypes: string[];
		picked: PickedMedia[];
		remaining: number;
	}) {
		let videoAvailable = !existingContentTypes.some((contentType) =>
			contentType.startsWith("video/"),
		);
		let skippedVideos = 0;
		const permitted = picked.filter((media) => {
			if (!media.mimeType?.startsWith("video/")) return true;
			if (!videoAvailable) {
				skippedVideos += 1;
				return false;
			}
			videoAvailable = false;
			return true;
		});
		const selected = permitted.slice(0, remaining);

		return {
			selected,
			skippedForCapacity: permitted.length - selected.length,
			skippedVideos,
		};
	}
</script>

<script lang="ts">
	import { page } from "$app/state";
	import {
		ArrowLeftIcon,
		CaretLeftIcon,
		CaretRightIcon,
		PencilSimpleIcon,
		PlusIcon,
		TrashIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { ApiError } from "$lib/api";
	import { showErrorToast } from "$lib/api/error";
	import {
		type AlbumContentResponse,
		deleteAlbum,
		deleteAlbumContent,
		getAlbumContent,
		getAlbumLimits,
		renameAlbum,
		reorderAlbumContent,
		uploadAlbumMedia,
	} from "$lib/api/messaging/albums";
	import {
		type AlbumAccess,
		discoverSharedAlbum,
		markAlbumUnavailable,
		readCachedAlbum,
		resolveCachedAlbum,
	} from "$lib/app-data/album-cache";
	import { getKeepUnavailableCachedAlbumsSnapshot } from "$lib/app-data/preferences.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import {
		ALBUM_NAME_MAX_BYTES,
		albumNameByteLength,
	} from "$lib/model/messaging/albums";
	import {
		closeAppDetail,
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
	import { pickMultipleMedia } from "$lib/platform/media-picker";
	import AlbumShares from "./AlbumShares.svelte";

	let { data }: import("./$types").PageProps = $props();

	const albumId = $derived(Number(page.params.albumId));
	const expectedOwnerProfileId = $derived.by(() => {
		const raw = page.url.searchParams.get("owner");
		if (raw === null) return null;
		const parsed = Number(raw);
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
	});

	let album = $state<AlbumContentResponse | null>(null);
	let error = $state<unknown>(null);
	let retainedAccess = $state<AlbumAccess | null>(null);
	let retainedLocked = $state(false);
	let busy = $state(false);
	let loadGeneration = 0;
	let uploadProgress = $state<{ completed: number; total: number } | null>(
		null,
	);

	const isMine = $derived(
		album !== null && album.profileId === data.ourProfileId,
	);

	let renameOpen = $state(false);
	let renameValue = $state("");
	const renameTooLong = $derived(
		albumNameByteLength(renameValue) > ALBUM_NAME_MAX_BYTES,
	);

	let deleteAlbumOpen = $state(false);

	type AlbumActionContext = {
		id: number;
		generation: number;
		target: AlbumContentResponse;
	};

	function getActionContext(): AlbumActionContext | null {
		if (album === null) return null;
		return {
			id: albumId,
			generation: loadGeneration,
			target: album,
		};
	}

	function isCurrentAction(context: AlbumActionContext): boolean {
		return (
			context.id === albumId &&
			context.generation === loadGeneration &&
			context.target === album
		);
	}

	async function load(id: number, expectedOwner: number | null) {
		const generation = ++loadGeneration;
		const isCurrentLoad = () =>
			generation === loadGeneration &&
			Object.is(id, albumId) &&
			Object.is(expectedOwner, expectedOwnerProfileId);
		album = null;
		error = null;
		busy = false;
		uploadProgress = null;
		renameOpen = false;
		deleteAlbumOpen = false;
		retainedAccess = null;
		retainedLocked = false;
		if (!Number.isFinite(id) || Number.isNaN(expectedOwner)) {
			if (isCurrentLoad()) error = new Error("Invalid album");
			return;
		}
		try {
			const loaded = await getAlbumContent(id);
			if (!isCurrentLoad()) return;
			if (expectedOwner !== null && loaded.profileId !== expectedOwner) {
				error = new Error("Album owner did not match the shared collection");
				return;
			}
			album = loaded;
			if (loaded.profileId !== data.ourProfileId) {
				void discoverSharedAlbum({
					albumId: loaded.albumId,
					ownerProfileId: loaded.profileId,
					isViewable: loaded.albumViewable,
					ownerValidated: true,
				});
			}
		} catch (err) {
			if (!isCurrentLoad()) return;
			if (
				err instanceof ApiError &&
				err.response?.status === 403 &&
				err.kind !== "RequestBlocked" &&
				err.kind !== "RequestCooldown"
			) {
				const identity =
					expectedOwner === null
						? null
						: {
								accountProfileId: data.ourProfileId,
								ownerProfileId: expectedOwner,
								albumId: id,
							};
				if (identity === null) {
					error = err;
					return;
				}
				await markAlbumUnavailable(identity, "revoked_or_removed").catch(
					(cacheError) =>
						console.error("Failed to mark cached album", cacheError),
				);
				if (!isCurrentLoad()) return;
				const cached = await readCachedAlbum(identity).catch((cacheError) => {
					console.error("Failed to read cached album", cacheError);
					return null;
				});
				if (!isCurrentLoad()) return;
				if (cached && cached.media.length > 0) {
					retainedAccess = {
						status: "unavailable",
						reason: "revoked_or_removed",
						detectedAt: Date.now(),
					};
					if (getKeepUnavailableCachedAlbumsSnapshot()) {
						const resolved = await resolveCachedAlbum(cached).catch(
							(cacheError) => {
								console.error("Failed to resolve cached album", cacheError);
								return null;
							},
						);
						if (!isCurrentLoad()) return;
						if (resolved === null) {
							error = err;
							return;
						}
						album = resolved;
					} else {
						retainedLocked = true;
					}
					return;
				}
			}
			console.error(err);
			error = err;
		}
	}

	$effect(() => {
		void load(albumId, expectedOwnerProfileId);
	});

	async function submitRename() {
		const context = getActionContext();
		if (context === null || renameTooLong || busy) return;
		const albumName = renameValue.trim() === "" ? null : renameValue;
		busy = true;
		try {
			await renameAlbum({ albumId: context.id, albumName });
			if (!isCurrentAction(context)) return;
			context.target.albumName = albumName;
			renameOpen = false;
		} catch (err) {
			if (!isCurrentAction(context)) return;
			console.error(err);
			showErrorToast({ label: "Failed to rename album", error: err });
		} finally {
			if (isCurrentAction(context)) busy = false;
		}
	}

	async function confirmDeleteAlbum() {
		const context = getActionContext();
		if (context === null || busy) return;
		busy = true;
		try {
			await deleteAlbum({ albumId: context.id });
			if (!isCurrentAction(context)) return;
			deleteAlbumOpen = false;
			toast.success("Album deleted");
			await closeAppDetail(page.url.pathname, page.state);
		} catch (err) {
			if (!isCurrentAction(context)) return;
			console.error(err);
			showErrorToast({ label: "Failed to delete album", error: err });
		} finally {
			if (isCurrentAction(context)) busy = false;
		}
	}

	async function removeContent(contentId: number) {
		const context = getActionContext();
		if (context === null || busy) return;
		const previous = context.target.content;
		busy = true;
		context.target.content = previous.filter(
			(item) => item.contentId !== contentId,
		);
		try {
			await deleteAlbumContent({ albumId: context.id, contentId });
		} catch (err) {
			if (!isCurrentAction(context)) return;
			console.error(err);
			context.target.content = previous;
			showErrorToast({ label: "Failed to delete media", error: err });
		} finally {
			if (isCurrentAction(context)) busy = false;
		}
	}

	async function moveContent(index: number, delta: number) {
		const context = getActionContext();
		if (context === null || busy) return;
		const target = index + delta;
		const previous = context.target.content;
		if (target < 0 || target >= previous.length) return;

		const next = [...previous];
		const [moved] = next.splice(index, 1);
		if (moved === undefined) return;
		next.splice(target, 0, moved);

		busy = true;
		context.target.content = next;
		try {
			// The API wants every id exactly once, so send the whole order.
			await reorderAlbumContent({
				albumId: context.id,
				contentIds: next.map((item) => item.contentId),
			});
		} catch (err) {
			if (!isCurrentAction(context)) return;
			console.error(err);
			context.target.content = previous;
			showErrorToast({ label: "Failed to reorder media", error: err });
		} finally {
			if (isCurrentAction(context)) busy = false;
		}
	}

	async function addMedia() {
		const context = getActionContext();
		if (context === null || !isMine || busy) return;
		busy = true;
		try {
			const limits = await getAlbumLimits();
			if (!isCurrentAction(context)) return;
			const remaining =
				limits.maxContentItemsPerAlbum - context.target.content.length;
			if (remaining <= 0) {
				toast.error("This album has reached its media limit");
				return;
			}
			const picked = await pickMultipleMedia("media");
			if (!isCurrentAction(context)) return;
			if (picked.length === 0) return;
			const { selected, skippedForCapacity, skippedVideos } = selectAlbumMedia({
				existingContentTypes: context.target.content.map(
					(item) => item.contentType,
				),
				picked,
				remaining,
			});
			if (skippedVideos > 0) {
				toast.warning(
					skippedVideos === 1
						? "Albums can contain only one video; the extra video was not added"
						: `Albums can contain only one video; ${skippedVideos} extra videos were not added`,
				);
			}
			if (skippedForCapacity > 0) {
				toast.warning(
					`Only ${remaining} ${remaining === 1 ? "item fits" : "items fit"} in this album`,
				);
			}
			if (selected.length === 0) return;
			uploadProgress = { completed: 0, total: selected.length };
			for (const media of selected) {
				if (!isCurrentAction(context)) return;
				await uploadAlbumMedia({
					albumId: context.id,
					media,
					maxBytes: limits.maxContentSizeInBytes,
				});
				if (!isCurrentAction(context)) return;
				if (uploadProgress !== null) uploadProgress.completed += 1;
			}
			await load(context.id, expectedOwnerProfileId);
			if (context.id === albumId) {
				toast.success(
					`${selected.length} ${selected.length === 1 ? "item" : "items"} added`,
				);
			}
		} catch (err) {
			if (!isCurrentAction(context)) return;
			console.error(err);
			// Reload because an earlier item in a multi-upload may have succeeded.
			await load(context.id, expectedOwnerProfileId);
			if (context.id === albumId)
				showErrorToast({ label: "Failed to add album media", error: err });
		} finally {
			if (isCurrentAction(context)) {
				uploadProgress = null;
				busy = false;
			}
		}
	}
</script>

<ProgressiveBlur
	direction="topToBottom"
	class="fixed top-0 left-0 z-20 h-[calc(4.75rem+var(--safe-area-top))] w-full shrink-0"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex items-center h-full pe-5.5 pt-(--safe-area-top)"
	tag="nav"
>
	<button
		type="button"
		onclick={() => void closeAppDetail(page.url.pathname, page.state)}
		class="flex h-full w-19 shrink-0 items-center justify-center"
		aria-label="Back"
	>
		<ArrowLeftIcon size={32} />
	</button>
	<span class="min-w-0 flex-1 truncate">
		{album?.albumName ?? "Album"}
	</span>
	{#if isMine}
		<div class="flex shrink-0 items-center gap-1">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Add media"
				disabled={busy}
				onclick={() => void addMedia()}
			>
				<PlusIcon class="size-5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Rename album"
				onclick={() => {
					renameValue = album?.albumName ?? "";
					renameOpen = true;
				}}
			>
				<PencilSimpleIcon class="size-5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Delete album"
				onclick={() => (deleteAlbumOpen = true)}
			>
				<TrashIcon class="size-5" />
			</Button>
		</div>
	{/if}
</ProgressiveBlur>

<main class="screen-nav-host">
	<div class="h-full w-full overflow-y-auto overscroll-none">
		<div class="flex w-full px-4 pt-19 pb-nav-clear">
			<div
				class="@container/photo-grid m-auto flex w-full max-w-200 flex-col gap-3 pb-16"
			>
				{#if retainedLocked}
					<div
						class="m-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-3xl border p-6 text-center"
					>
						<p class="text-lg font-semibold">Access revoked</p>
						<p class="text-sm text-muted-foreground">
							The sender may have revoked access or removed this album. A cached
							copy remains on this device.
						</p>
						<Button
							href="/settings/app"
							onclick={(event) =>
								interceptAppNavigationClick(event, () =>
									openAppDetail("/settings/app"),
								)}
						>
							Open App Settings
						</Button>
					</div>
				{:else if error !== null}
					<ApiErrorDisplay
						{error}
						onRetry={() => void load(albumId, expectedOwnerProfileId)}
						class="m-auto mt-8"
					/>
				{:else if album === null}
					<div class="photo-grid">
						{#each Array(6)}
							<Skeleton class="aspect-square rounded-none" />
						{/each}
					</div>
				{:else}
					{#if retainedAccess !== null}
						<div
							class="rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-sm"
							role="status"
						>
							Cached copy · Access revoked or album removed
						</div>
					{/if}
					{#if uploadProgress !== null}
						<p class="text-sm text-muted-foreground" role="status">
							Uploading {uploadProgress.completed + 1} of
							{uploadProgress.total}…
						</p>
					{/if}
					{#if album.content.length === 0}
						<div
							class="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed p-6 text-center"
						>
							<p class="text-muted-foreground">This album is empty.</p>
							{#if isMine}
								<Button disabled={busy} onclick={() => void addMedia()}>
									<PlusIcon />
									Add photos or videos
								</Button>
							{/if}
						</div>
					{:else}
						<div class="photo-grid">
							{#each album.content as item, index (item.contentId)}
								<div class="relative aspect-square">
									{#if item.contentType.startsWith("video/") && item.url !== ""}
										<!-- No caption resource exists in the album API. -->
										<!-- svelte-ignore a11y_media_has_caption -->
										<video
											src={item.url}
											poster={item.thumbUrl}
											controls
											preload="metadata"
											class="size-full bg-card-foreground/10 object-cover"
										></video>
									{:else}
										<img
											src={item.thumbUrl}
											alt=""
											class="size-full bg-card-foreground/10 object-cover"
											draggable="false"
										/>
									{/if}
									{#if isMine}
										<div class="absolute inset-x-0 top-0 flex justify-end p-1">
											<Button
												variant="secondary"
												size="icon"
												class="size-7 bg-black/60 text-white hover:bg-black/80"
												aria-label="Delete media"
												disabled={busy}
												onclick={() => void removeContent(item.contentId)}
											>
												<TrashIcon class="size-4" />
											</Button>
										</div>
										<div
											class="absolute inset-x-0 bottom-0 flex justify-between p-1"
										>
											<Button
												variant="secondary"
												size="icon"
												class="size-7 bg-black/60 text-white hover:bg-black/80"
												aria-label="Move earlier"
												disabled={busy || index === 0}
												onclick={() => void moveContent(index, -1)}
											>
												<CaretLeftIcon class="size-4" />
											</Button>
											<Button
												variant="secondary"
												size="icon"
												class="size-7 bg-black/60 text-white hover:bg-black/80"
												aria-label="Move later"
												disabled={busy || index === album.content.length - 1}
												onclick={() => void moveContent(index, 1)}
											>
												<CaretRightIcon class="size-4" />
											</Button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
				{#if isMine && album !== null}
					<AlbumShares {albumId} />
				{/if}
			</div>
		</div>
	</div>
</main>

<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rename album</Dialog.Title>
		</Dialog.Header>
		<Input bind:value={renameValue} placeholder="Album name" />
		{#if renameTooLong}
			<p class="text-sm text-destructive">
				Name is too long ({albumNameByteLength(
					renameValue,
				)}/{ALBUM_NAME_MAX_BYTES}
				bytes).
			</p>
		{/if}
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (renameOpen = false)}
				disabled={busy}
			>
				Cancel
			</Button>
			<Button
				onclick={() => void submitRename()}
				disabled={busy || renameTooLong}
			>
				Save
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteAlbumOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this album?</AlertDialog.Title>
			<AlertDialog.Description>
				The album and everyone's access to it will be removed. This cannot be
				undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				disabled={busy}
				onclick={() => void confirmDeleteAlbum()}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
