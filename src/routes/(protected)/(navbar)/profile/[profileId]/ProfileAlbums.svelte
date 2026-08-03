<script lang="ts">
	import { goto } from "$app/navigation";
	import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";

	import { ApiError } from "$lib/api";
	import { showErrorToast } from "$lib/api/error";
	import {
		createAlbum,
		getAlbumsSharedByProfile,
		getMyAlbums,
	} from "$lib/api/messaging/albums";
	import {
		type AlbumAccess,
		discoverSharedAlbum,
		listCachedAlbumsByOwner,
		markAlbumUnavailable,
	} from "$lib/app-data/album-cache";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import type { MyAlbum, SharedAlbum } from "$lib/model/messaging/albums";

	let {
		profileId,
		self,
	}: {
		profileId: number;
		self: boolean;
	} = $props();

	/** Both album shapes reduced to what this list renders. */
	type AlbumEntry = {
		albumId: number;
		albumName: string | null;
		coverUrl: string | null;
		itemCount: number | null;
		hasUnseenContent: boolean;
		access: AlbumAccess | null;
	};

	function fromMyAlbum(album: MyAlbum): AlbumEntry {
		const first = album.content[0];
		return {
			albumId: album.albumId,
			albumName: album.albumName,
			coverUrl: first?.coverUrl ?? first?.thumbUrl ?? null,
			itemCount: album.content.length,
			// Only shared albums carry this — nothing is ever unseen in your own.
			hasUnseenContent: false,
			access: null,
		};
	}

	function fromSharedAlbum(album: SharedAlbum): AlbumEntry {
		const counts = album.contentCount;
		return {
			albumId: album.albumId,
			albumName: album.albumName,
			coverUrl: album.content?.coverUrl ?? null,
			itemCount: counts ? counts.imageCount + counts.videoCount : null,
			hasUnseenContent: album.hasUnseenContent,
			access: album.albumViewable
				? { status: "active", validatedAt: Date.now() }
				: {
						status: "unavailable",
						reason: "views_exhausted",
						detectedAt: Date.now(),
					},
		};
	}

	function accessLabel(access: AlbumAccess | null): string | null {
		if (access?.status !== "unavailable") return null;
		if (access.reason === "expired") return "Expired";
		if (access.reason === "views_exhausted") return "View limit reached";
		return "Access revoked";
	}

	let albums = $state<AlbumEntry[] | null>(null);
	let error = $state<unknown>(null);
	let loadGeneration = 0;

	async function load(id: number, isSelf: boolean) {
		const generation = ++loadGeneration;
		albums = null;
		error = null;
		try {
			let loaded: AlbumEntry[];
			if (isSelf) {
				loaded = (await getMyAlbums()).map(fromMyAlbum);
			} else {
				const shared = await getAlbumsSharedByProfile(id);
				const remoteIds = new Set(shared.map((album) => album.albumId));
				for (const album of shared) {
					void discoverSharedAlbum({
						albumId: album.albumId,
						ownerProfileId: album.profileId,
						expirationType: album.expirationType,
						expiresAt: album.expiresAt,
						isViewable: album.albumViewable,
					});
				}
				const cached = await listCachedAlbumsByOwner(id);
				const missing = cached.filter(
					(record) => !remoteIds.has(record.albumId),
				);
				await Promise.all(
					missing.map((record) =>
						markAlbumUnavailable(record.albumId, "revoked_or_removed"),
					),
				);
				loaded = [
					...shared.map(fromSharedAlbum),
					...missing.map((record) => ({
						albumId: record.albumId,
						albumName: record.album.albumName,
						coverUrl: null,
						itemCount: record.album.content.length,
						hasUnseenContent: false,
						access: {
							status: "unavailable" as const,
							reason: "revoked_or_removed" as const,
							detectedAt: Date.now(),
						},
					})),
				];
			}
			if (generation !== loadGeneration || id !== profileId || isSelf !== self)
				return;
			albums = loaded;
		} catch (err) {
			if (generation !== loadGeneration || id !== profileId || isSelf !== self)
				return;
			console.error(err);
			error = err;
		}
	}

	$effect(() => {
		void load(profileId, self);
	});

	let creating = $state(false);

	async function create() {
		if (creating) return;
		creating = true;
		try {
			const { albumId } = await createAlbum({ albumName: null });
			await goto(`/albums/${albumId}`);
		} catch (err) {
			console.error(err);
			const status = err instanceof ApiError ? err.response?.status : null;
			showErrorToast({
				label:
					status === 402
						? "You've reached your album limit"
						: "Failed to create album",
				error: err,
			});
		} finally {
			creating = false;
		}
	}
</script>

{#if self || error !== null || albums === null || albums.length > 0}
	<div class="mt-4 flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<span class="text-sm text-muted-foreground uppercase">Albums</span>
			{#if self}
				<Button
					variant="ghost"
					size="sm"
					disabled={creating}
					onclick={() => void create()}
				>
					<PlusIcon weight="bold" />
					New album
				</Button>
			{/if}
		</div>
		{#if error !== null}
			<ApiErrorDisplay
				{error}
				onRetry={() => void load(profileId, self)}
				class="my-2"
			/>
		{:else if albums === null}
			<div class="flex gap-2">
				{#each Array(3)}
					<Skeleton class="aspect-square w-24 rounded-xl" />
				{/each}
			</div>
		{:else}
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each albums as album (album.albumId)}
					<a
						href="/albums/{album.albumId}"
						class="flex w-24 shrink-0 flex-col gap-1"
					>
						<div class="relative aspect-square">
							{#if album.coverUrl}
								<img
									src={album.coverUrl}
									alt=""
									class="size-full rounded-xl bg-card-foreground/10 object-cover"
									draggable="false"
								/>
							{:else}
								<div
									class="flex size-full items-center justify-center rounded-xl bg-card-foreground/10 text-muted-foreground"
								>
									<FolderOpenIcon weight="fill" class="size-6" />
								</div>
							{/if}
							{#if album.hasUnseenContent}
								<span
									class="absolute end-1 top-1 size-2.5 rounded-full bg-primary outline-2 outline-background"
									aria-label="Unseen content"
								></span>
							{/if}
						</div>
						<span class="truncate text-sm">
							{album.albumName ?? "Untitled album"}
						</span>
						{#if album.itemCount !== null}
							<span class="text-xs text-muted-foreground">
								{album.itemCount}
								{album.itemCount === 1 ? "item" : "items"}
							</span>
						{/if}
						{#if accessLabel(album.access) !== null}
							<span class="text-xs font-medium text-accent">
								{accessLabel(album.access)}
							</span>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
{/if}
