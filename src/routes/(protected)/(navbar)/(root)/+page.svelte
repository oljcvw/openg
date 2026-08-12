<script lang="ts">
	import { tick } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import {
		getGeohashSnapshot,
		hydratePreferences,
	} from "$lib/app-data/preferences.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { registerRootActivationRefresh } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		ScrollCaptureGate,
		type SurfaceScrollPosition,
	} from "$lib/navigation/navigation-memory";
	import Grid from "./Grid.svelte";
	import LocationChooser from "./LocationEmpty.svelte";
	import TopBar from "./top-bar/TopBar.svelte";

	const preferencesHydrated = hydratePreferences();
	const geohash = $derived(getGeohashSnapshot());
	const accountSession = getAccountSessionSnapshot();

	let gridContainer: HTMLElement | null = $state(null);
	let grid: {
		restoreAnchor(position: SurfaceScrollPosition): Promise<void>;
	} | null = $state(null);
	const captureGate = new ScrollCaptureGate();
	$effect(() =>
		registerRootActivationRefresh("/", () =>
			captureGate.suppressDuring(async () => {
				navigationMemory.clearSurfaceAnchor("browse", accountSession);
				gridContainer?.scrollTo({ top: 0, behavior: "smooth" });
				await gridState.refresh();
			}),
		),
	);

	let scrollRestored = false;
	$effect(() => {
		if (
			!scrollRestored &&
			gridContainer &&
			!gridState.loading &&
			gridState.error === null
		) {
			scrollRestored = true;
			const position = navigationMemory.getSurfaceScrollPosition(
				"browse",
				accountSession,
			);
			if (position && position.contentGeneration === gridState.resultGeneration)
				void tick().then(() => grid?.restoreAnchor(position));
			else if (position)
				navigationMemory.clearSurfaceAnchor("browse", accountSession);
		}
	});

	function captureScroll(): void {
		if (!gridContainer || !captureGate.canCapture) return;
		const anchor = captureScrollAnchor(gridContainer);
		navigationMemory.setSurfaceAnchor(
			"browse",
			anchor,
			accountSession,
			captureScrollNeighborhood(gridContainer, anchor.itemKey),
			gridState.resultGeneration,
		);
	}
</script>

<svelte:head>
	<title>Open Grind</title>
</svelte:head>
{#await preferencesHydrated then}
	{#if geohash === null}
		<main class="m-auto flex max-w-full flex-1">
			<LocationChooser />
		</main>
	{:else}
		<main class="screen-nav-host">
			<TopBar />
			<div
				class="pull-scroller"
				bind:this={gridContainer}
				onscroll={captureScroll}
			>
				<div
					class="@container/photo-grid flex min-h-overscrollable flex-col gap-4 px-4 pt-17 pb-nav-clear"
				>
					<Grid bind:this={grid} {geohash} />
				</div>
			</div>
			{#if !gridState.loading && !gridState.error}
				<DataRefreshControl
					container={gridContainer}
					updating={gridState.refreshing}
					position="top"
					onrefresh={() => void gridState.refresh()}
				/>
			{/if}
		</main>
	{/if}
{/await}
