<script lang="ts">
	import z from "zod";
	import toast from "svelte-french-toast";
	import { uniqBy } from "lodash-es";
	import {
		getGrid,
		mergeResolvedGridProfiles,
		resolvePartialBatch,
		type GridProfile,
	} from "./grid";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import ProfileMiniCard from "./ProfileMiniCard.svelte";
	import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade";
	import { Button } from "$lib/components/ui/button";
	import { onMount } from "svelte";

	let {
		geohash,
	}: {
		geohash: string;
	} = $props();

	const VIRTUAL_OVERSCAN_ROWS = 4;

	let items = $state<GridProfile[]>([]);
	let partialBatches: { batch: { profileId: number }[] }[] = [];
	let nextPage: number | null = $state(0);
	let loadingMore = $state(false);
	let currentQuery: z.infer<typeof cascadeV3QuerySchema> | null = null;
	let gridEl: HTMLDivElement | null = $state(null);
	let columnCount = $state(1);
	let rowHeight = $state(160);
	let viewportTop = $state(0);
	let viewportHeight = $state(0);

	export function refresh() {
		items = [];
		partialBatches = [];
		nextPage = 0;
		loadingMore = false;
		currentQuery = null;
		profiles = fetchProfiles();
	}

	const loadingBatches = new Set<number>();

	async function loadMore() {
		if (loadingMore || !nextPage || !currentQuery) return;
		loadingMore = true;
		try {
			const batchOffset = partialBatches.length;
			const result = await getGrid({ ...currentQuery, pageNumber: nextPage });
			for (const item of result.items) {
				items.push(
					item.type === "partial"
						? { ...item, batchIndex: item.batchIndex + batchOffset }
						: item,
				);
			}
			partialBatches.push(...result.partialBatches);
			nextPage = result.nextPage;
		} catch (error) {
			console.error(error);
			toast.error("Failed to load more profiles");
		} finally {
			loadingMore = false;
		}
	}

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting)
					loadMore().catch((error) => console.error(error));
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	async function loadBatch(batchIndex: number) {
		if (loadingBatches.has(batchIndex)) return;
		loadingBatches.add(batchIndex);
		try {
			const profileIds = partialBatches[batchIndex].batch.map(
				(p) => p.profileId,
			);
			const resolved = await resolvePartialBatch(profileIds);
			items = mergeResolvedGridProfiles({
				items,
				requestedIds: profileIds,
				resolvedProfiles: resolved,
			});
		} catch (error) {
			console.error(batchIndex, error);
			toast.error("Failed to load profiles");
			loadingBatches.delete(batchIndex);
		}
	}

	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadBatch(params.batchIndex).catch((error) => console.error(error));
					observer.disconnect();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	let profiles = $state(fetchProfiles());

	async function fetchProfiles() {
		try {
			const { gridSearchFilters } = await getPreferences();
			const query = {
				nearbyGeoHash: geohash,
				favorites: gridSearchFilters?.isFavorite || undefined,
				onlineOnly: gridSearchFilters?.isOnline || undefined,
				rightNow: gridSearchFilters?.isRightNow || undefined,
				...(gridSearchFilters?.ageEnabled && {
					ageMin: gridSearchFilters?.age[0],
					ageMax: gridSearchFilters?.age[1],
				}),
				...(gridSearchFilters?.genderEnabled && {
					genders: gridSearchFilters?.genders,
				}),
				...(gridSearchFilters?.positionEnabled && {
					sexualPositions: gridSearchFilters?.positions,
				}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-photos") && {
						photoOnly: true,
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-albums") && {
						hasAlbum: gridSearchFilters?.photos.includes("has-albums"),
					}),
				...(gridSearchFilters?.photosEnabled &&
					gridSearchFilters?.photos.includes("has-profile-pic") && {
						faceOnly: gridSearchFilters?.photos.includes("has-face-pics"),
					}),
				...(gridSearchFilters?.tribesEnabled && {
					tribes: gridSearchFilters?.tribes,
				}),
				...(gridSearchFilters?.bodyTypesEnabled && {
					bodyTypes: gridSearchFilters?.bodyTypes,
				}),
				...(gridSearchFilters?.heightEnabled && {
					heightCmMin: gridSearchFilters?.height[0],
					heightCmMax: gridSearchFilters?.height[1],
				}),
				...(gridSearchFilters?.weightEnabled && {
					weightGramsMin: gridSearchFilters?.weight[0],
					weightGramsMax: gridSearchFilters?.weight[1],
				}),
				...(gridSearchFilters?.relationshipStatusesEnabled && {
					relationshipStatuses: gridSearchFilters?.relationshipStatuses,
				}),
				...(gridSearchFilters?.acceptNSFWPicsEnabled &&
					gridSearchFilters?.acceptNSFWPics !== undefined && {
						nsfwPics: gridSearchFilters?.acceptNSFWPics,
					}),
				...(gridSearchFilters?.lookingForEnabled && {
					lookingFor: gridSearchFilters?.lookingFor,
				}),
				...(gridSearchFilters?.meetAtEnabled && {
					meetAt: gridSearchFilters?.meetAt,
				}),
				notRecentlyChatted:
					gridSearchFilters?.haventChattedTodayEnabled || undefined,
				...(gridSearchFilters?.healthPracticesEnabled && {
					sexualHealth: gridSearchFilters?.healthPractices,
				}),
				fresh: gridSearchFilters?.isFresh || undefined,
			} satisfies z.infer<typeof cascadeV3QuerySchema>;
			currentQuery = query;
			const result = await getGrid(query);
			loadingBatches.clear();
			items = result.items;
			partialBatches = result.partialBatches;
			nextPage = result.nextPage;
		} catch (error) {
			console.error(error);
			throw new Error("Failed to fetch profiles", { cause: error });
		}
	}

	const gridProfiles = $derived(uniqBy(items, "id"));

	function updateVirtualGrid() {
		if (!gridEl) return;

		const rect = gridEl.getBoundingClientRect();
		const styles = getComputedStyle(gridEl);
		const columns = styles.gridTemplateColumns
			.split(" ")
			.filter((column) => column.trim() !== "").length;
		const rowGap = Number.parseFloat(styles.rowGap) || 0;

		columnCount = Math.max(1, columns);
		rowHeight = gridEl.clientWidth / columnCount + rowGap;
		viewportTop = Math.max(0, -rect.top);
		viewportHeight = window.innerHeight;
	}

	onMount(() => {
		updateVirtualGrid();

		const observer = new ResizeObserver(updateVirtualGrid);
		if (gridEl) observer.observe(gridEl);
		window.addEventListener("scroll", updateVirtualGrid, { passive: true });
		window.addEventListener("resize", updateVirtualGrid);

		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", updateVirtualGrid);
			window.removeEventListener("resize", updateVirtualGrid);
		};
	});

	$effect(() => {
		gridProfiles.length;
		queueMicrotask(updateVirtualGrid);
	});

	const totalVirtualRows = $derived(
		Math.ceil(gridProfiles.length / Math.max(1, columnCount)),
	);
	const startVirtualRow = $derived(
		Math.max(0, Math.floor(viewportTop / rowHeight) - VIRTUAL_OVERSCAN_ROWS),
	);
	const endVirtualRow = $derived(
		Math.min(
			totalVirtualRows,
			Math.ceil((viewportTop + viewportHeight) / rowHeight) +
				VIRTUAL_OVERSCAN_ROWS,
		),
	);
	const topVirtualRows = $derived(startVirtualRow);
	const bottomVirtualRows = $derived(Math.max(0, totalVirtualRows - endVirtualRow));
	const visibleGridProfiles = $derived(
		gridProfiles.slice(startVirtualRow * columnCount, endVirtualRow * columnCount),
	);

	function virtualSpacerHeight(rows: number) {
		return `${Math.max(0, rows * rowHeight)}px`;
	}
</script>

<div
	class="grid grid-cols-2 xxs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full gap-0.5 px-1 flex-1"
	bind:this={gridEl}
>
	{#await profiles}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-stone-700 animate-pulse"></div>
		{/each}
	{:then}
		{#if topVirtualRows > 0}
			<div
				class="col-span-full"
				style:height={virtualSpacerHeight(topVirtualRows)}
			></div>
		{/if}
		{#each visibleGridProfiles as item (item.id)}
			{#if item.type === "full"}
				<ProfileMiniCard
					id={item.id}
					displayName={item.displayName}
					distance={item.distance}
					medias={item.profilePhotosHashes?.map((mediaHash) => ({
						mediaHash,
					})) ?? []}
				/>
			{:else}
				<div
					class="aspect-square bg-stone-700 animate-pulse"
					use:observePartial={{ batchIndex: item.batchIndex }}
				></div>
			{/if}
		{/each}
		{#if bottomVirtualRows > 0}
			<div
				class="col-span-full"
				style:height={virtualSpacerHeight(bottomVirtualRows)}
			></div>
		{/if}
		{#if loadingMore}
			{#each Array.from({ length: 20 })}
				<div class="aspect-square bg-stone-700 animate-pulse"></div>
			{/each}
		{/if}
		{#if nextPage !== 0}
			<div class="col-span-full h-0" use:observeSentinel></div>
		{/if}
	{:catch error}
		<div class="p-4 flex col-span-full">
			<div class="m-auto flex flex-col gap-4">
				<p class="text-center text-red-400 font-medium">
					{error.message}
				</p>
				<Button onclick={() => (profiles = fetchProfiles())}>Retry</Button>
			</div>
		</div>
	{/await}
</div>
