<script lang="ts">
	import { tick } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { registerRootActivationRefresh } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		ScrollCaptureGate,
		type SurfaceScrollPosition,
	} from "$lib/navigation/navigation-memory";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
	import { getNow, subscribeNow } from "$lib/util/now.svelte";
	import RightNowFeed from "./RightNowFeed.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let { data }: import("./$types").PageProps = $props();

	const ourProfileId = $derived(data.ourProfileId);
	const accountSession = getAccountSessionSnapshot();
	let feedContainer: HTMLElement | null = $state(null);
	let feed: {
		restoreAnchor(position: SurfaceScrollPosition): Promise<void>;
	} | null = $state(null);
	const captureGate = new ScrollCaptureGate();
	$effect(() =>
		registerRootActivationRefresh("/right-now", () =>
			captureGate.suppressDuring(async () => {
				navigationMemory.clearSurfaceAnchor("rightNow", accountSession);
				feedContainer?.scrollTo({ top: 0, behavior: "smooth" });
				await rightNowState.refresh();
			}),
		),
	);
	let scrollRestored = false;

	$effect(() => subscribeNow());
	$effect.pre(() => {
		void rightNowState.load();
	});
	$effect(() => {
		if (!rightNowState.loading || !feedContainer) return;
		scrollRestored = false;
		feedContainer.scrollTop = 0;
	});
	$effect(() => {
		if (
			scrollRestored ||
			!feedContainer ||
			rightNowState.loading ||
			rightNowState.error
		)
			return;
		scrollRestored = true;
		const position = navigationMemory.getSurfaceScrollPosition(
			"rightNow",
			accountSession,
		);
		if (position) void tick().then(() => feed?.restoreAnchor(position));
	});

	function captureScroll(): void {
		if (!feedContainer || !captureGate.canCapture) return;
		const anchor = captureScrollAnchor(feedContainer);
		navigationMemory.setSurfaceAnchor(
			"rightNow",
			anchor,
			accountSession,
			captureScrollNeighborhood(feedContainer, anchor.itemKey),
		);
	}

	const status = $derived.by(() => {
		if (rightNowState.loading) return "Loading Right Now posts";
		if (rightNowState.error) return "Right Now feed failed to load";
		const count = rightNowState.visiblePosts(getNow()).length;
		return `${count} Right Now ${count === 1 ? "post" : "posts"} shown`;
	});
</script>

<svelte:head>
	<title>Right Now — Open Grind</title>
</svelte:head>

<main class="screen-nav-host">
	<TopBar />
	<div class="pull-scroller" bind:this={feedContainer} onscroll={captureScroll}>
		<div
			class="mx-auto flex min-h-overscrollable w-full max-w-360 flex-col gap-4 px-2 pt-17 pb-nav-clear"
		>
			<p class="sr-only" aria-live="polite">{status}</p>
			<RightNowFeed
				bind:this={feed}
				{ourProfileId}
				scrollElement={feedContainer}
			/>
		</div>
	</div>
	{#if !rightNowState.loading && !rightNowState.error}
		<DataRefreshControl
			container={feedContainer}
			updating={rightNowState.refreshing}
			position="top"
			onrefresh={() => void rightNowState.refresh()}
		/>
	{/if}
</main>
