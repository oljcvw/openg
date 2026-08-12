<script lang="ts">
	import { beforeNavigate } from "$app/navigation";
	import { onDestroy, tick, untrack } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { nearestScrollableAncestor } from "$lib/components/feedback/refresh/scroll-chain";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import VirtualCollection from "$lib/components/virtual/VirtualCollection.svelte";
	import { registerRootActivationRefresh } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		restoreVirtualScrollAnchor,
	} from "$lib/navigation/navigation-memory";
	import { ProfileSummariesState } from "$lib/profile/profile-summaries.svelte";
	import EmptyTapsList from "./EmptyTapsList.svelte";
	import TapReceivedProfile from "./TapReceivedProfile.svelte";
	import { TapsState } from "./taps-state.svelte";

	let {
		ourProfileId,
	}: {
		ourProfileId: number;
	} = $props();

	const taps = untrack(() => new TapsState({ ourProfileId }));
	const accountSession = getAccountSessionSnapshot();
	const summaries = new ProfileSummariesState();
	onDestroy(() => taps.destroy());

	$effect(() => {
		void summaries.load(taps.taps.map((tap) => tap.profileId));
	});

	let container: HTMLDivElement | null = $state(null);
	let collection: { scrollToIndex(index: number): Promise<void> } | null =
		$state(null);
	$effect(() =>
		registerRootActivationRefresh("/interest/taps", async () => {
			navigationMemory.clearSurfaceAnchor("interestTaps", accountSession);
			container?.scrollTo({ top: 0, behavior: "smooth" });
			await taps.refresh();
		}),
	);

	beforeNavigate(() => {
		if (!container) return;
		const anchor = captureScrollAnchor(container);
		navigationMemory.setSurfaceAnchor(
			"interestTaps",
			anchor,
			accountSession,
			captureScrollNeighborhood(container, anchor.itemKey),
		);
	});

	let scrollRestored = false;
	$effect(() => {
		if (scrollRestored || !container || taps.loading || taps.error) return;
		scrollRestored = true;
		const el = container;
		const position = navigationMemory.getSurfaceScrollPosition(
			"interestTaps",
			accountSession,
		);
		// Restoring scroll against the empty skeleton frame would clamp the target to 0
		if (position)
			void tick().then(() => {
				if (!collection) return;
				const virtualCollection = collection;
				return restoreVirtualScrollAnchor({
					container: el,
					anchor: position.anchor,
					neighborhood: position.neighborhood,
					logicalItemKeys: taps.taps.map((tap) => String(tap.profileId)),
					scrollToIndex: (index) => virtualCollection.scrollToIndex(index),
				});
			});
	});

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) taps.loadMore();
			},
			{ root: nearestScrollableAncestor(node), rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

<div class="screen-nav-host">
	<div bind:this={container} class="pull-scroller">
		<div
			class="mx-auto flex min-h-overscrollable w-full max-w-360 flex-col gap-2 px-2 pt-16 pb-nav-clear"
		>
			{#if taps.loading}
				{#each Array(8)}
					<Skeleton class="h-24.5 w-full shrink-0" />
				{/each}
			{:else if taps.error}
				<div class="flex flex-1">
					<ApiErrorDisplay
						error={taps.error}
						onRetry={() => taps.retry()}
						class="m-auto"
					/>
				</div>
			{:else}
				{#if taps.taps.length > 0}
					<VirtualCollection
						bind:this={collection}
						items={taps.taps}
						scrollElement={container}
						getKey={(tap) => tap.profileId}
						estimateSize={98}
						gap={8}
					>
						{#snippet children(tap)}
							<div data-navigation-item-key={String(tap.profileId)}>
								<TapReceivedProfile
									{tap}
									summary={summaries.get(tap.profileId)}
								/>
							</div>
						{/snippet}
					</VirtualCollection>
				{:else}
					<EmptyTapsList />
				{/if}
				{#if taps.hasMore}
					<div class="h-0" use:observeSentinel></div>
				{/if}
			{/if}
		</div>
	</div>
	{#if !taps.loading && !taps.error}
		<DataRefreshControl
			{container}
			updating={taps.refreshing}
			position="top"
			onrefresh={() => void taps.refresh()}
		/>
	{/if}
</div>
