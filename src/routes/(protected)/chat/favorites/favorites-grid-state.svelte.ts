import { defaultFilters } from "$lib/components/filters/filters";
import { GridState } from "$lib/grid/grid-state.svelte";

export const favoritesGridState = new GridState({
	getFilters: async () => defaultFilters,
	queryTransform: (query) => ({
		...query,
		favorites: true,
	}),
});
