<script lang="ts">
	import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
	import PlusIcon from "phosphor-svelte/lib/PlusIcon";
	import { tick } from "svelte";

	import { ApiError } from "$lib/api";
	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import { showErrorToast } from "$lib/api/error";
	import {
		createAlbum,
		getAlbumLimits,
		getMyAlbums,
	} from "$lib/api/messaging/albums";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import InboxTabs from "$lib/components/shared/InboxTabs.svelte";
	import NavBar from "$lib/components/shared/NavBar.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import {
		ALBUM_NAME_MAX_BYTES,
		albumNameByteLength,
		type AlbumStorageLimits,
		type MyAlbum,
	} from "$lib/model/messaging/albums";
	import {
		interceptAppNavigationClick,
		openAppDetail,
		registerRootActivationRefresh,
	} from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		restoreScrollAnchor,
		ScrollCaptureGate,
	} from "$lib/navigation/navigation-memory";

	let albums = $state<MyAlbum[] | null>(null);
	let limits = $state<AlbumStorageLimits | null>(null);
	let error = $state<unknown>(null);
	let createOpen = $state(false);
	let createName = $state("");
	let creating = $state(false);
	let container: HTMLDivElement | null = $state(null);
	let scrollRestored = false;
	const accountSession = getAccountSessionSnapshot();
	const captureGate = new ScrollCaptureGate();

	const createNameTooLong = $derived(
		albumNameByteLength(createName) > ALBUM_NAME_MAX_BYTES,
	);
	const atAlbumLimit = $derived(
		limits !== null && albums !== null && albums.length >= limits.maxAlbums,
	);

	function cover(album: MyAlbum): string | null {
		const first = album.content[0];
		return first?.coverUrl ?? first?.thumbUrl ?? null;
	}

	async function load() {
		albums = null;
		error = null;
		try {
			[albums, limits] = await Promise.all([getMyAlbums(), getAlbumLimits()]);
		} catch (err) {
			console.error(err);
			error = err;
		}
	}

	$effect(() =>
		registerRootActivationRefresh("/albums", () =>
			captureGate.suppressDuring(async () => {
				navigationMemory.clearSurfaceAnchor("inboxAlbums", accountSession);
				container?.scrollTo({ top: 0, behavior: "smooth" });
				await load();
			}),
		),
	);

	$effect(() => {
		if (scrollRestored || !container || albums === null || error !== null)
			return;
		scrollRestored = true;
		const el = container;
		const position = navigationMemory.getSurfaceScrollPosition(
			"inboxAlbums",
			accountSession,
		);
		if (position)
			void tick().then(() =>
				restoreScrollAnchor(
					el,
					position.anchor,
					undefined,
					undefined,
					position.neighborhood,
				),
			);
	});

	void load();

	async function submitCreate() {
		if (creating || createNameTooLong || atAlbumLimit) return;
		creating = true;
		try {
			const albumName = createName.trim() === "" ? null : createName;
			const created = await createAlbum({ albumName });
			createOpen = false;
			createName = "";
			await load();
			await openAppDetail(`/albums/${created.albumId}`);
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

<main class="screen-nav-host">
	<div
		bind:this={container}
		class="h-full overflow-y-auto overscroll-contain"
		onscroll={() => {
			if (!container || !captureGate.canCapture) return;
			const anchor = captureScrollAnchor(container);
			navigationMemory.setSurfaceAnchor(
				"inboxAlbums",
				anchor,
				accountSession,
				captureScrollNeighborhood(container, anchor.itemKey),
			);
		}}
	>
		<div
			class="mx-auto flex min-h-overscrollable w-full max-w-200 flex-col gap-4 px-4 pt-4 pb-nav-clear"
		>
			<InboxTabs class="sticky top-4 z-10 mx-auto w-full max-w-90 shadow-md" />
			<header class="flex items-center justify-between gap-3">
				<div>
					<h1 class="text-2xl font-semibold">Albums</h1>
					{#if limits !== null && albums !== null}
						<p class="text-sm text-muted-foreground">
							{albums.length} of {limits.maxAlbums} albums
						</p>
					{/if}
				</div>
				<Button disabled={atAlbumLimit} onclick={() => (createOpen = true)}>
					<PlusIcon />
					New album
				</Button>
			</header>

			{#if error !== null}
				<ApiErrorDisplay
					{error}
					onRetry={() => void load()}
					class="m-auto mt-8"
				/>
			{:else if albums === null}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each Array(6)}
						<Skeleton class="aspect-square rounded-3xl" />
					{/each}
				</div>
			{:else if albums.length === 0}
				<div
					class="flex min-h-64 flex-col items-center justify-center gap-3 rounded-4xl border border-dashed p-8 text-center"
				>
					<FolderOpenIcon weight="fill" class="size-12 text-muted-foreground" />
					<div>
						<h2 class="font-medium">No albums yet</h2>
						<p class="text-sm text-muted-foreground">
							Create an album to organize and privately share media.
						</p>
					</div>
					<Button onclick={() => (createOpen = true)}>
						<PlusIcon />
						Create album
					</Button>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each albums as album (album.albumId)}
						{@const coverUrl = cover(album)}
						<a
							data-navigation-item-key={String(album.albumId)}
							href="/albums/{album.albumId}"
							onclick={(event) =>
								interceptAppNavigationClick(event, () =>
									openAppDetail(`/albums/${album.albumId}`),
								)}
							class="group flex min-w-0 flex-col gap-2 rounded-3xl border bg-card p-2 shadow-sm transition-transform active:scale-98"
						>
							<div class="aspect-square overflow-hidden rounded-2xl bg-muted">
								{#if coverUrl}
									<img
										src={coverUrl}
										alt=""
										class="size-full object-cover transition-transform group-hover:scale-105"
										draggable="false"
									/>
								{:else}
									<div
										class="flex size-full items-center justify-center text-muted-foreground"
									>
										<FolderOpenIcon weight="fill" class="size-10" />
									</div>
								{/if}
							</div>
							<div class="min-w-0 px-1 pb-1">
								<h2 class="truncate font-medium">
									{album.albumName ?? "Untitled album"}
								</h2>
								<p class="text-sm text-muted-foreground">
									{album.content.length}
									{album.content.length === 1 ? "item" : "items"}
									{#if album.sharedCount > 0}
										· shared with {album.sharedCount}
									{/if}
								</p>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</main>
<NavBar />

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Create album</Dialog.Title>
			<Dialog.Description>
				You can add photos and videos after creating it.
			</Dialog.Description>
		</Dialog.Header>
		<Input
			bind:value={createName}
			placeholder="Album name (optional)"
			aria-invalid={createNameTooLong}
		/>
		<p
			class={[
				"text-xs",
				createNameTooLong ? "text-destructive" : "text-muted-foreground",
			]}
		>
			{albumNameByteLength(createName)}/{ALBUM_NAME_MAX_BYTES} bytes
		</p>
		<Dialog.Footer>
			<Button
				variant="outline"
				disabled={creating}
				onclick={() => (createOpen = false)}
			>
				Cancel
			</Button>
			<Button
				disabled={creating || createNameTooLong || atAlbumLimit}
				onclick={() => void submitCreate()}
			>
				{creating ? "Creating…" : "Create"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
