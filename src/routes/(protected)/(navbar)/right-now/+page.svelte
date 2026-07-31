<script lang="ts">
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
	import { getNow, subscribeNow } from "$lib/util/now.svelte";
	import RightNowFeed from "./RightNowFeed.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	let { data }: import("./$types").PageProps = $props();

	const ourProfileId = $derived(data.ourProfileId);
	let feedContainer: HTMLElement | null = $state(null);
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
		feedContainer.scrollTop = rightNowState.scrollY;
	});

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
	<div
		class="pull-scroller"
		bind:this={feedContainer}
		onscroll={() => (rightNowState.scrollY = feedContainer?.scrollTop ?? 0)}
	>
		<div
			class="mx-auto flex min-h-overscrollable w-full max-w-160 flex-col gap-4 px-4 pt-17 pb-nav-clear"
		>
			<p class="sr-only" aria-live="polite">{status}</p>
			<RightNowFeed {ourProfileId} />
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
