<script lang="ts">
	import "photoswipe/style.css";
	import { onDestroy } from "svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import { nearestScrollableAncestor } from "$lib/components/feedback/refresh/scroll-chain";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
	import { getNow } from "$lib/util/now.svelte";
	import RightNowEmptyFeed from "./RightNowEmptyFeed.svelte";
	import RightNowPost from "./RightNowPost.svelte";

	let {
		ourProfileId,
	}: {
		ourProfileId: number;
	} = $props();

	let feedContainer: HTMLElement | null = $state(null);
	let lightbox: PhotoSwipeLightbox | null = null;
	const posts = $derived(rightNowState.visiblePosts(getNow()));
	const hasMore = $derived(rightNowState.hasMore(getNow()));

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

	$effect(() => {
		if (!feedContainer || posts.length === 0) return;
		let cancelled = false;
		import("photoswipe/lightbox")
			.then(({ default: Lightbox }) => {
				if (cancelled || !feedContainer) return;
				lightbox?.destroy();
				lightbox = new Lightbox({
					gallery: feedContainer,
					children: "a.pswp-trigger",
					pswpModule: () => import("photoswipe"),
					counter: false,
				});
				lightbox.addFilter("itemData", (itemData) => {
					const image = itemData.element?.querySelector("img");
					if (image?.naturalWidth) {
						itemData.width = image.naturalWidth;
						itemData.height = image.naturalHeight;
					}
					return itemData;
				});
				const onBackGesture = () => {
					lightbox?.pswp?.close();
					return false;
				};
				lightbox.on("beforeOpen", () =>
					backGestureEventHandlers.add(onBackGesture),
				);
				lightbox.on("close", () =>
					backGestureEventHandlers.delete(onBackGesture),
				);
				lightbox.on("destroy", () =>
					backGestureEventHandlers.delete(onBackGesture),
				);
				lightbox.init();
			})
			.catch((error) => console.error(error));
		return () => {
			cancelled = true;
			lightbox?.destroy();
			lightbox = null;
		};
	});

	onDestroy(() => lightbox?.destroy());
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
		{#each posts as post (post.id)}
			<RightNowPost {post} {ourProfileId} />
		{:else}
			<RightNowEmptyFeed />
		{/each}
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
