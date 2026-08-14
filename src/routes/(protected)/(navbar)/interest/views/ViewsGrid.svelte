<script lang="ts">
	import { beforeNavigate } from "$app/navigation";
	import { onDestroy, tick, untrack } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { nearestScrollableAncestor } from "$lib/components/feedback/refresh/scroll-chain";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import {
		responsiveGridColumnCount,
		toGridRows,
	} from "$lib/components/virtual/virtual-grid";
	import { observeElementWidth } from "$lib/components/virtual/element-width-observer";
	import VirtualCollection from "$lib/components/virtual/VirtualCollection.svelte";
	import { registerRootActivationRefresh } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		restoreVirtualScrollAnchor,
	} from "$lib/navigation/navigation-memory";
	import EmptyViewsGrid from "./EmptyViewsGrid.svelte";
	import ViewedPreview from "./ViewedPreview.svelte";
	import ViewedProfile from "./ViewedProfile.svelte";
	import { ViewsState } from "./views-state.svelte";

	let { ourProfileId }: { ourProfileId: number } = $props();

	const views = untrack(() => new ViewsState({ ourProfileId }));
	const accountSession = getAccountSessionSnapshot();
	onDestroy(() => views.destroy());

	let container: HTMLDivElement | null = $state(null);
	let gridRoot: HTMLDivElement | null = $state(null);
	let collection: { scrollToIndex(index: number): Promise<void> } | null =
		$state(null);
	let gridWidth = $state(0);
	const columnCount = $derived(responsiveGridColumnCount(gridWidth));
	const viewRows = $derived(toGridRows(views.views, columnCount));
	const estimatedRowSize = $derived(
		Math.max(120, (gridWidth - (columnCount - 1) * 2) / columnCount),
	);
	$effect(() =>
		registerRootActivationRefresh("/interest/views", async () => {
			navigationMemory.clearSurfaceAnchor("interestViews", accountSession);
			container?.scrollTo({ top: 0, behavior: "smooth" });
			await views.refresh();
		}),
	);

	beforeNavigate(() => {
		if (!container) return;
		const anchor = captureScrollAnchor(container);
		navigationMemory.setSurfaceAnchor(
			"interestViews",
			anchor,
			accountSession,
			captureScrollNeighborhood(container, anchor.itemKey),
		);
	});

	let scrollRestored = false;
	$effect(() => {
		if (scrollRestored || !container || views.loading || views.error) return;
		scrollRestored = true;
		const el = container;
		const position = navigationMemory.getSurfaceScrollPosition(
			"interestViews",
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
					logicalItemKeys: views.views.map((entry) => entry.key),
					toVirtualIndex: (itemIndex) => Math.floor(itemIndex / columnCount),
					scrollToIndex: (index) => virtualCollection.scrollToIndex(index),
				});
			});
	});

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) views.loadMore();
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

	function observeWidth(node: HTMLDivElement) {
		return observeElementWidth(node, (width) => (gridWidth = width));
	}
</script>

<div class="screen-nav-host">
	<div bind:this={container} class="pull-scroller">
		<div
			class="@container/photo-grid flex min-h-overscrollable w-full flex-col gap-4 px-4 pt-16 pb-nav-clear"
		>
			{#if views.loading}
				<div class="photo-grid">
					{#each Array(24)}
						<Skeleton class="aspect-square rounded-none" />
					{/each}
				</div>
			{:else if views.error}
				<div class="flex flex-1">
					<ApiErrorDisplay
						error={views.error}
						onRetry={() => views.retry()}
						class="m-auto"
					/>
				</div>
			{:else if views.views.length === 0}
				<EmptyViewsGrid />
			{:else}
				<div
					bind:this={gridRoot}
					class="mx-auto w-full max-w-400 overflow-clip rounded-grid"
					use:observeWidth
				>
					<VirtualCollection
						bind:this={collection}
						items={viewRows}
						scrollElement={container}
						getKey={(row) => row.map((entry) => entry.key).join(":")}
						estimateSize={estimatedRowSize}
						measurementKey={columnCount}
						gap={2}
					>
						{#snippet children(row)}
							<div
								class="grid gap-0.5"
								style:grid-template-columns={`repeat(${columnCount}, minmax(0, 1fr))`}
							>
								{#each row as entry (entry.key)}
									<div data-navigation-item-key={entry.key}>
										{#if entry.type === "profile"}
											<ViewedProfile view={entry.profile} />
										{:else}
											<ViewedPreview preview={entry.preview} />
										{/if}
									</div>
								{/each}
							</div>
						{/snippet}
					</VirtualCollection>
				</div>
				{#if views.hasMore}
					<div class="h-0" use:observeSentinel></div>
				{/if}
			{/if}
		</div>
	</div>
	{#if !views.loading && !views.error}
		<DataRefreshControl
			{container}
			updating={views.refreshing}
			position="top"
			onrefresh={() => void views.refresh()}
		/>
	{/if}
</div>
