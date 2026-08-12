<script lang="ts">
	import { FolderOpenIcon, ImageBrokenIcon, VideoIcon } from "phosphor-svelte";
	import { onDestroy, onMount } from "svelte";

	import {
		type AlbumContentResponse,
		getAlbumContent,
		getReceivedAlbums,
	} from "$lib/api/messaging/albums";
	import {
		getInboxRowDensitySnapshot,
		type InboxRowDensity,
		subscribePreferences,
	} from "$lib/app-data/preferences.svelte";
	import { ConversationMediaViewerState } from "$lib/chat/conversation-media-viewer.svelte";
	import {
		isSafeToHydrateReceivedAlbum,
		ReceivedAlbumHydrator,
	} from "$lib/chat/received-albums";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import AlbumMediaDrawer from "$lib/components/media/AlbumMediaDrawer.svelte";
	import MixedMediaViewer from "$lib/components/media/MixedMediaViewer.svelte";
	import InboxTabs from "$lib/components/shared/InboxTabs.svelte";
	import NavBar from "$lib/components/shared/NavBar.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import type { ReceivedAlbumBrief } from "$lib/model/messaging/albums";

	let albums = $state<ReceivedAlbumBrief[] | null>(null);
	let details = $state<Record<number, AlbumContentResponse>>({});
	let error = $state<unknown>(null);
	let drawerOpen = $state(false);
	let drawerAlbum = $state<AlbumContentResponse | null>(null);
	let rowDensity: InboxRowDensity = $state(getInboxRowDensitySnapshot());
	let explicitGeneration = 0;
	const viewer = new ConversationMediaViewerState();
	const hydrator = new ReceivedAlbumHydrator<AlbumContentResponse>(
		(albumId, signal) => getAlbumContent(albumId, { signal }),
		2,
	);

	const rowMinimum = $derived(
		rowDensity === "compact"
			? "5rem"
			: rowDensity === "roomy"
				? "8rem"
				: "6.5rem",
	);

	onMount(() =>
		subscribePreferences(() => {
			rowDensity = getInboxRowDensitySnapshot();
		}),
	);

	onDestroy(() => {
		explicitGeneration += 1;
		hydrator.clear();
		viewer.close();
	});

	async function load(): Promise<void> {
		error = null;
		try {
			albums = await getReceivedAlbums();
		} catch (caught) {
			error = caught;
		}
	}

	void load();

	function remember(album: AlbumContentResponse): AlbumContentResponse {
		details = { ...details, [album.albumId]: album };
		return album;
	}

	function hydrateVisible(node: HTMLElement, album: ReceivedAlbumBrief) {
		if (!isSafeToHydrateReceivedAlbum(album)) return {};
		let visible = false;
		const start = () => {
			visible = true;
			void hydrator
				.request(album.albumId)
				.then((loaded) => {
					if (visible && loaded !== null) remember(loaded);
				})
				.catch(() => {
					// A row remains usable through its explicit action after lazy failure.
				});
		};
		if (typeof IntersectionObserver === "undefined") {
			start();
			return {
				destroy() {
					visible = false;
					hydrator.cancel(album.albumId);
				},
			};
		}
		const observer = new IntersectionObserver(
			(records) => {
				const nextVisible = records.some((record) => record.isIntersecting);
				if (nextVisible && !visible) start();
				else if (!nextVisible && visible) {
					visible = false;
					hydrator.cancel(album.albumId);
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				visible = false;
				observer.disconnect();
				hydrator.cancel(album.albumId);
			},
		};
	}

	async function resolveExplicit(album: ReceivedAlbumBrief) {
		return (
			details[album.albumId] ?? remember(await getAlbumContent(album.albumId))
		);
	}

	async function openDrawer(album: ReceivedAlbumBrief): Promise<void> {
		const generation = ++explicitGeneration;
		drawerAlbum = details[album.albumId] ?? null;
		drawerOpen = true;
		if (drawerAlbum !== null) return;
		try {
			const loaded = await resolveExplicit(album);
			if (generation === explicitGeneration && drawerOpen) drawerAlbum = loaded;
		} catch (caught) {
			if (generation === explicitGeneration) {
				drawerOpen = false;
				error = caught;
			}
		}
	}

	function showViewer(
		album: AlbumContentResponse,
		index: number,
		opener: HTMLButtonElement,
	): void {
		const items = album.content.map((item) => ({
			id: String(item.contentId),
			kind: item.contentType.startsWith("video/")
				? ("video" as const)
				: ("image" as const),
			url: item.url.length > 0 ? item.url : null,
			poster: item.coverUrl ?? item.thumbUrl,
			unavailableLabel: "Album item unavailable",
		}));
		const selected = items[index];
		if (!selected) return;
		viewer.open({
			items,
			startId: selected.id,
			messageId: null,
			opener,
			preload: [1, 1],
			diagnostics: {
				surface: "received_albums",
				cacheSource: "network",
				access: "persistent",
			},
		});
	}

	async function openDirect(
		album: ReceivedAlbumBrief,
		index: number,
		opener: HTMLButtonElement,
	): Promise<void> {
		if (!isSafeToHydrateReceivedAlbum(album)) {
			await openDrawer(album);
			return;
		}
		try {
			showViewer(await resolveExplicit(album), index, opener);
		} catch (caught) {
			error = caught;
		}
	}

	function ownerPosition(album: ReceivedAlbumBrief): string | null {
		if (albums === null) return null;
		const sameOwner = albums.filter(
			(candidate) => candidate.profileId === album.profileId,
		);
		if (sameOwner.length < 2) return null;
		return `${sameOwner.findIndex((candidate) => candidate.albumId === album.albumId) + 1} of ${sameOwner.length}`;
	}
</script>

<main class="screen-nav-host">
	<div class="h-full overflow-y-auto overscroll-contain">
		<div
			class="mx-auto flex min-h-overscrollable w-full max-w-240 flex-col gap-3 px-3 pt-3 pb-nav-clear sm:px-4"
		>
			<InboxTabs class="sticky top-3 z-10 mx-auto w-full max-w-90 shadow-md" />
			<header class="px-1">
				<h1 class="text-2xl font-semibold">Received albums</h1>
				<p class="text-sm text-muted-foreground">
					Albums shared with you, newest first.
				</p>
			</header>

			{#if error !== null}
				<ApiErrorDisplay
					{error}
					onRetry={() => void load()}
					class="m-auto mt-8"
				/>
			{:else if albums === null}
				{#each Array(6)}
					<Skeleton
						class="w-full rounded-2xl"
						style={`min-block-size: ${rowMinimum}`}
					/>
				{/each}
			{:else if albums.length === 0}
				<div
					class="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed p-8 text-center"
				>
					<FolderOpenIcon weight="fill" class="size-12 text-muted-foreground" />
					<div>
						<h2 class="font-medium">No received albums</h2>
						<p class="text-sm text-muted-foreground">
							Albums shared with this account will appear here.
						</p>
					</div>
				</div>
			{:else}
				<div class="grid gap-2">
					{#each albums as album (album.albumId)}
						{@const hydrated = details[album.albumId]}
						{@const previewItems =
							hydrated?.content ?? (album.content ? [album.content] : [])}
						<article
							class={[
								"relative flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border bg-card p-2 shadow-sm",
								album.hasUnseenContent && "ring-2 ring-primary/50",
							]}
							style:min-block-size={rowMinimum}
							use:hydrateVisible={album}
						>
							<button
								type="button"
								class="min-w-36 flex-1 rounded-xl px-2 py-2 text-start outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-primary/70"
								onclick={() => void openDrawer(album)}
								aria-label="Open received album"
							>
								<div class="flex items-center gap-2">
									<span class="truncate font-semibold">
										{album.albumName ?? "Untitled album"}
									</span>
									{#if album.hasUnseenContent}<Badge>New</Badge>{/if}
								</div>
								<p class="text-xs text-muted-foreground">
									Shared with you
									{#if ownerPosition(album)}
										· {ownerPosition(album)}{/if}
								</p>
							</button>

							<div
								class="flex max-w-full flex-none gap-1.5 overflow-x-auto"
								aria-label="Album media"
							>
								{#if previewItems.length === 0}
									<div
										class="flex size-18 items-center justify-center rounded-lg bg-muted text-muted-foreground"
									>
										<ImageBrokenIcon class="size-7" />
									</div>
								{:else}
									{#each previewItems as item, index (item.contentId)}
										<button
											type="button"
											class="relative size-18 shrink-0 overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-3 focus-visible:ring-primary/70 disabled:opacity-70"
											aria-label={`Open album media ${index + 1}`}
											disabled={!isSafeToHydrateReceivedAlbum(album)}
											onclick={(event) =>
												void openDirect(album, index, event.currentTarget)}
										>
											{#if item.coverUrl}
												<img
													src={item.coverUrl}
													alt=""
													class="size-full object-cover"
													loading="lazy"
												/>
											{:else if "thumbUrl" in item && typeof item.thumbUrl === "string"}
												<img
													src={item.thumbUrl}
													alt=""
													class="size-full object-cover"
													loading="lazy"
												/>
											{:else}
												<ImageBrokenIcon
													class="m-auto size-6 text-muted-foreground"
												/>
											{/if}
											{#if item.contentType.startsWith("video/")}
												<span
													class="absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-white"
												>
													<VideoIcon weight="fill" class="size-3.5" />
												</span>
											{/if}
										</button>
									{/each}
								{/if}
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</main>
<NavBar />

<AlbumMediaDrawer
	bind:open={drawerOpen}
	album={drawerAlbum}
	onOpenItem={(index, opener) =>
		drawerAlbum && showViewer(drawerAlbum, index, opener)}
/>

{#if viewer.ready}
	<MixedMediaViewer
		items={viewer.items}
		startIndex={viewer.startIndex}
		opener={viewer.opener}
		preload={viewer.preload}
		diagnostics={viewer.diagnostics}
		onOpening={() => viewer.markOpening()}
		onOpened={() => viewer.markOpened()}
		onClose={() => viewer.close()}
	/>
{/if}
