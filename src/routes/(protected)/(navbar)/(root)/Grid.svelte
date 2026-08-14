<script lang="ts">
	import { onDestroy, tick, untrack } from "svelte";

	import { getGridColumnsSnapshot } from "$lib/app-data/preferences.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import { nearestScrollableAncestor } from "$lib/components/feedback/refresh/scroll-chain";
	import { observeElementWidth } from "$lib/components/virtual/element-width-observer";
	import {
		responsiveGridColumnCount,
		toGridRows,
	} from "$lib/components/virtual/virtual-grid";
	import VirtualCollection from "$lib/components/virtual/VirtualCollection.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		restoreVirtualScrollAnchor,
		type SurfaceScrollPosition,
	} from "$lib/navigation/navigation-memory";
	import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
	import type { GridProfile } from "$lib/grid/grid";
	import EmptyGrid from "./EmptyGrid.svelte";
	import GridProfileMiniCard from "./GridProfileMiniCard.svelte";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	const gridColumns = $derived(getGridColumnsSnapshot());
	type GridColumns = ReturnType<typeof getGridColumnsSnapshot>;
	let gridRoot: HTMLDivElement | null = $state(null);
	let collection: {
		scrollToIndex(index: number): Promise<void>;
		remeasure(): Promise<void>;
	} | null = $state(null);
	let gridWidth = $state(0);
	let requestedGridWidth = 0;
	let appliedGridColumns: GridColumns = $state(getGridColumnsSnapshot());
	let layoutGeneration = 0;
	let layoutTask = Promise.resolve();
	let layoutActive = true;
	onDestroy(() => {
		layoutActive = false;
		layoutGeneration += 1;
	});
	const scrollElement = $derived(
		gridRoot
			? (nearestScrollableAncestor(gridRoot) as HTMLDivElement | null)
			: null,
	);
	const columnCount = $derived(
		responsiveGridColumnCount(gridWidth, appliedGridColumns),
	);
	const gridProfiles = $derived.by(() => {
		const byId = new Map<number, GridProfile>();
		for (const item of gridState.items) {
			const existing = byId.get(item.id);
			if (!existing || (existing.type === "lazy" && item.type === "rendered")) {
				byId.set(item.id, item);
			}
		}
		return [...byId.values()];
	});
	const gridRows = $derived(toGridRows(gridProfiles, columnCount));
	const estimatedRowSize = $derived(
		Math.max(120, (gridWidth - (columnCount - 1) * 2) / columnCount),
	);

	$effect.pre(() => {
		const activeGeohash = geohash;
		untrack(() => gridState.load(activeGeohash));
	});

	$effect(() => {
		const reportVisibility = () =>
			reportClientDiagnostic({
				category: "browse_lifecycle",
				component: "grid",
				code: document.hidden ? "visibility_hidden" : "visibility_visible",
				level: "info",
			});
		const reportOrientation = () =>
			reportClientDiagnostic({
				category: "browse_layout",
				component: "grid",
				code: "orientation_changed",
				level: "info",
			});
		document.addEventListener("visibilitychange", reportVisibility);
		window.addEventListener("orientationchange", reportOrientation);
		reportVisibility();
		return () => {
			document.removeEventListener("visibilitychange", reportVisibility);
			window.removeEventListener("orientationchange", reportOrientation);
		};
	});

	function observePageTrigger(node: HTMLElement, params: { enabled: boolean }) {
		let enabled = params.enabled;
		const observer = new IntersectionObserver(
			(entries) => {
				if (enabled && entries[0]?.isIntersecting)
					gridState.loadMore().catch((error) => console.error(error));
			},
			{ root: nearestScrollableAncestor(node) },
		);
		observer.observe(node);
		return {
			update(next: { enabled: boolean }) {
				const becameEnabled = !enabled && next.enabled;
				enabled = next.enabled;
				if (becameEnabled) {
					observer.unobserve(node);
					observer.observe(node);
				}
			},
			destroy() {
				observer.disconnect();
			},
		};
	}

	function observeLazy(node: HTMLElement, params: { id: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					gridState
						.resolveProfile(params.id)
						.catch((error) => console.error(error));
				}
			},
			{ root: nearestScrollableAncestor(node), rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	function observeProfileVisibility(node: HTMLElement, params: { id: number }) {
		let visible = false;
		const observer = new IntersectionObserver(
			(entries) => {
				const nextVisible = entries[0]?.isIntersecting ?? false;
				if (nextVisible === visible) return;
				visible = nextVisible;
				gridState.setProfileVisible(params.id, visible);
			},
			{ root: nearestScrollableAncestor(node), rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
				if (visible) gridState.setProfileVisible(params.id, false);
			},
		};
	}

	function observeWidth(node: HTMLDivElement) {
		return observeElementWidth(node, (width) => {
			requestedGridWidth = width;
			queueGridLayout(width, gridColumns);
		});
	}

	$effect(() => {
		const requestedGridColumns = gridColumns;
		untrack(() => queueGridLayout(requestedGridWidth, requestedGridColumns));
	});

	function queueGridLayout(width: number, columns: GridColumns): void {
		layoutTask = layoutTask
			.then(() => applyGridLayout(width, columns))
			.catch(() => {
				reportClientDiagnostic({
					category: "browse_layout",
					component: "grid",
					code: "layout_failed",
					level: "error",
				});
			});
	}

	async function applyGridLayout(
		width: number,
		columns: GridColumns,
	): Promise<void> {
		if (
			!layoutActive ||
			(width === gridWidth && columns === appliedGridColumns)
		)
			return;
		const generation = ++layoutGeneration;
		const startedAt = performance.now();
		reportClientDiagnostic({
			category: "browse_layout",
			component: "grid",
			code: "layout_start",
			level: "info",
		});
		const activeContainer = scrollElement;
		const anchor = activeContainer
			? captureScrollAnchor(activeContainer)
			: null;
		const neighborhood =
			activeContainer && anchor
				? captureScrollNeighborhood(activeContainer, anchor.itemKey)
				: null;
		gridWidth = width;
		appliedGridColumns = columns;
		await tick();
		if (generation !== layoutGeneration) return;
		const activeCollection = collection;
		await activeCollection?.remeasure();
		if (
			generation !== layoutGeneration ||
			!activeContainer ||
			!anchor ||
			!activeCollection
		)
			return reportLayoutCompletion(startedAt, true);
		const result = await restoreVirtualScrollAnchor({
			container: activeContainer,
			anchor,
			neighborhood,
			logicalItemKeys: gridProfiles.map((item) => String(item.id)),
			toVirtualIndex: (itemIndex) => Math.floor(itemIndex / columnCount),
			scrollToIndex: (index) => activeCollection.scrollToIndex(index),
		});
		reportClientDiagnostic({
			category: "browse_layout",
			component: "grid",
			code: result.itemKey ? "anchor_restored" : "anchor_failed",
			level: result.itemKey ? "info" : "warning",
		});
		reportLayoutCompletion(startedAt, true);
	}

	function reportLayoutCompletion(startedAt: number, settled: boolean): void {
		const duration = performance.now() - startedAt;
		const bucket =
			duration <= 100 ? "fast" : duration <= 368 ? "moderate" : "slow";
		reportClientDiagnostic({
			category: "browse_layout",
			component: "grid",
			code: settled ? `layout_settled_${bucket}` : `layout_unsettled_${bucket}`,
			level: settled ? "info" : "warning",
		});
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
			logicalItemKeys: gridProfiles.map((item) => String(item.id)),
			toVirtualIndex: (itemIndex) => Math.floor(itemIndex / columnCount),
			scrollToIndex: (index) => virtualCollection.scrollToIndex(index),
		});
	}
</script>

<div
	bind:this={gridRoot}
	class="relative mx-auto w-full max-w-400 overflow-clip rounded-grid"
	data-columns={gridColumns === "auto" ? undefined : gridColumns}
	use:observeWidth
>
	{#if gridState.loading}
		<div class="photo-grid">
			{#each Array.from({ length: 20 })}
				<div class="aspect-square animate-pulse bg-stone-700"></div>
			{/each}
		</div>
	{:else if gridState.error}
		<div class="col-span-full flex p-4">
			<ApiErrorDisplay
				error={gridState.error}
				onRetry={() => gridState.retry()}
				class="m-auto"
			/>
		</div>
	{:else}
		{#if gridProfiles.length > 0}
			<VirtualCollection
				bind:this={collection}
				items={gridRows}
				{scrollElement}
				getKey={(row) => row.map((item) => item.id).join(":")}
				estimateSize={estimatedRowSize}
				measurementKey={columnCount}
				gap={2}
			>
				{#snippet children(row, rowIndex)}
					<div
						class="grid gap-0.5"
						style:grid-template-columns={`repeat(${columnCount}, minmax(0, 1fr))`}
					>
						{#each row as item, cellIndex (item.id)}
							<div
								class="aspect-square"
								data-navigation-item-key={String(item.id)}
								use:observePageTrigger={{
									enabled:
										gridState.hasMoreProfiles &&
										rowIndex * columnCount + cellIndex ===
											Math.max(0, gridProfiles.length - 5),
								}}
								use:observeProfileVisibility={{ id: item.id }}
							>
								{#if item.type === "rendered"}
									<GridProfileMiniCard
										id={item.id}
										displayName={item.displayName}
										distance={item.distance}
										unread={item.unread}
										onlineUntil={item.onlineUntil}
										isFavorite={item.isFavorite}
										isRightNow={item.isRightNow}
										isVisiting={item.isVisiting}
										hadRecentChat={item.hasChattedInLast24Hrs}
										medias={item.profilePhotosHashes?.map((mediaHash) => ({
											mediaHash,
										})) ?? []}
									/>
								{:else}
									<div
										class="aspect-square animate-pulse bg-stone-700"
										use:observeLazy={{ id: item.id }}
									></div>
								{/if}
							</div>
						{/each}
					</div>
				{/snippet}
			</VirtualCollection>
		{:else}
			<EmptyGrid />
		{/if}
		{#if gridState.loadingMore}
			<div class="photo-grid">
				{#each Array.from({ length: 20 })}
					<div class="aspect-square animate-pulse bg-stone-700"></div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
