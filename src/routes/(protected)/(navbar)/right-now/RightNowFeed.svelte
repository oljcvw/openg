<script lang="ts">
	import "photoswipe/style.css";
	import { onDestroy } from "svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import { nearestScrollableAncestor } from "$lib/components/feedback/refresh/scroll-chain";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import VirtualCollection from "$lib/components/virtual/VirtualCollection.svelte";
	import { backLayerManager } from "$lib/navigation/app-navigation";
	import {
		restoreVirtualScrollAnchor,
		type SurfaceScrollPosition,
	} from "$lib/navigation/navigation-memory";
	import { ProfileSummariesState } from "$lib/profile/profile-summaries.svelte";
	import { createRightNowMediaSession } from "$lib/right-now/right-now-media";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
	import { getNow } from "$lib/util/now.svelte";
	import RightNowEmptyFeed from "./RightNowEmptyFeed.svelte";
	import RightNowPost from "./RightNowPost.svelte";

	let {
		ourProfileId,
		scrollElement,
	}: {
		ourProfileId: number;
		scrollElement: HTMLElement | null;
	} = $props();

	let feedContainer: HTMLElement | null = $state(null);
	let collection: { scrollToIndex(index: number): Promise<void> } | null =
		$state(null);
	let lightbox: PhotoSwipeLightbox | null = null;
	let releaseBackLayer: (() => void) | null = null;
	let activeMediaOpener: HTMLAnchorElement | null = null;
	let activeViewerElement: HTMLElement | null = null;
	let viewerCloseRequested = false;
	const posts = $derived(rightNowState.visiblePosts(getNow()));
	const hasMore = $derived(rightNowState.hasMore(getNow()));
	const summaries = new ProfileSummariesState();
	$effect(() => rightNowState.pruneExpired(getNow()));

	$effect(() => {
		void summaries.load(posts.map((post) => post.profileId));
	});

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) rightNowState.loadMore();
			},
			{ root: nearestScrollableAncestor(node), rootMargin: "400px" },
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function closeViewer() {
		viewerCloseRequested = true;
		lightbox?.pswp?.close();
		return "handled" as const;
	}

	function onViewerKeydown(event: KeyboardEvent) {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopImmediatePropagation();
		closeViewer();
	}

	function releaseViewerInputs() {
		releaseBackLayer?.();
		releaseBackLayer = null;
		window.removeEventListener("keydown", onViewerKeydown, true);
		document.removeEventListener("keydown", onViewerKeydown, true);
		activeViewerElement?.removeEventListener("keydown", onViewerKeydown, true);
		activeViewerElement = null;
	}

	function acquireViewerInputs(opener: HTMLAnchorElement) {
		releaseViewerInputs();
		activeMediaOpener = opener;
		releaseBackLayer = backLayerManager.register({
			priority: "viewer",
			handler: closeViewer,
		});
		window.addEventListener("keydown", onViewerKeydown, true);
		document.addEventListener("keydown", onViewerKeydown, true);
	}

	function restoreMediaFocus() {
		const opener = activeMediaOpener;
		activeMediaOpener = null;
		queueMicrotask(() => opener?.focus());
	}

	$effect(() => {
		if (!feedContainer) return;
		let cancelled = false;
		import("photoswipe/lightbox")
			.then(({ default: Lightbox }) => {
				if (cancelled || !feedContainer) return;
				lightbox?.destroy();
				lightbox = new Lightbox({
					pswpModule: () => import("photoswipe"),
					counter: false,
					escKey: false,
				});
				lightbox.addFilter("itemData", (itemData) => {
					const image = itemData.element?.querySelector("img");
					if (image?.naturalWidth) {
						itemData.width = image.naturalWidth;
						itemData.height = image.naturalHeight;
					}
					return itemData;
				});
				lightbox.on("afterInit", () => {
					activeViewerElement = lightbox?.pswp?.element ?? null;
					activeViewerElement?.addEventListener(
						"keydown",
						onViewerKeydown,
						true,
					);
					if (viewerCloseRequested) lightbox?.pswp?.close();
				});
				lightbox.on("openingAnimationEnd", () => {
					if (viewerCloseRequested) lightbox?.pswp?.close();
				});
				lightbox.on("close", () => {
					releaseViewerInputs();
					viewerCloseRequested = false;
				});
				lightbox.on("closingAnimationEnd", () => {
					restoreMediaFocus();
				});
				lightbox.on("destroy", () => {
					releaseViewerInputs();
					viewerCloseRequested = false;
					restoreMediaFocus();
				});
				lightbox.init();
			})
			.catch(() => console.error("Right Now media viewer failed to load"));
		return () => {
			cancelled = true;
			releaseViewerInputs();
			activeMediaOpener = null;
			lightbox?.destroy();
			lightbox = null;
		};
	});

	function openMedia(mediaKey: string, opener: HTMLAnchorElement): void {
		const session = createRightNowMediaSession(posts, mediaKey);
		if (!session || !lightbox) return;
		viewerCloseRequested = false;
		acquireViewerInputs(opener);
		lightbox.loadAndOpen(session.index, session.dataSource);
	}

	export async function restoreAnchor(
		position: SurfaceScrollPosition,
	): Promise<void> {
		if (!scrollElement || !collection) return;
		const virtualCollection = collection;
		await restoreVirtualScrollAnchor({
			container: scrollElement,
			anchor: position.anchor,
			neighborhood: position.neighborhood,
			logicalItemKeys: posts.map((post) => String(post.id)),
			scrollToIndex: (index) => virtualCollection.scrollToIndex(index),
		});
	}

	onDestroy(() => {
		releaseViewerInputs();
		activeMediaOpener = null;
		lightbox?.destroy();
	});
</script>

<div bind:this={feedContainer} class="flex w-full flex-col gap-3">
	{#if rightNowState.loading}
		{#each Array(8)}
			<Skeleton class="h-28 w-full shrink-0" />
		{/each}
	{:else if rightNowState.error}
		<div class="flex min-h-80">
			<ApiErrorDisplay
				error={rightNowState.error}
				onRetry={() => void rightNowState.retry()}
				class="m-auto"
			/>
		</div>
	{:else}
		{#if rightNowState.viewerCount > 0}
			<p class="text-center text-sm text-muted-foreground">
				{rightNowState.viewerCount.toLocaleString()}
				{rightNowState.viewerCount === 1 ? "person is" : "people are"} looking Right
				Now
			</p>
		{/if}
		{#if posts.length > 0}
			<VirtualCollection
				bind:this={collection}
				items={posts}
				{scrollElement}
				getKey={(post) => post.id}
				estimateSize={180}
				gap={12}
			>
				{#snippet children(post)}
					<div data-navigation-item-key={String(post.id)}>
						<RightNowPost
							{post}
							{ourProfileId}
							summary={summaries.get(post.profileId)}
							onOpenMedia={openMedia}
						/>
					</div>
				{/snippet}
			</VirtualCollection>
		{:else}
			<RightNowEmptyFeed />
		{/if}
		{#if hasMore}
			<button
				type="button"
				class="h-8 text-sm text-primary underline-offset-4 hover:underline"
				onclick={() => rightNowState.loadMore()}
				use:observeSentinel
			>
				Load more posts
			</button>
		{/if}
	{/if}
</div>
