import { defaultFilters } from "$lib/components/filters/filters";
import { GridState } from "$lib/grid/grid-state.svelte";

export const favoritesGridState = new GridState({
	filters: {
		value: { ...defaultFilters },
		ready: Promise.resolve(),
		set() {},
		resetFilters() {},
	},
	queryTransform: (query) => ({
		...query,
		favorites: true,
	}),
	errorLabels: {
		loadMore: "Failed to load more favorites",
		loadBatch: "Failed to load favorite profiles",
		fetch: "Failed to fetch favorite profiles",
		refresh: "Failed to refresh favorite profiles",
	},
});
