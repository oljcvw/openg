import {
	type BrowseAgeScaleUpdateResult,
	resetBrowseAgeScale,
	setBrowseAgeScale,
} from "$lib/app-data/preferences.svelte";
import { gridState } from "$lib/grid/grid-state.svelte";
import type { BrowseAgeScale } from "$lib/components/filters/filters";

function synchronizeGrid(
	result: BrowseAgeScaleUpdateResult,
): BrowseAgeScaleUpdateResult {
	gridState.filters.sync(result.gridSearchFilters);
	if (result.ageSelectionClamped && result.gridSearchFilters.ageEnabled) {
		gridState.invalidate();
	}
	return result;
}

export async function applyBrowseAgeScale(
	scale: BrowseAgeScale,
): Promise<BrowseAgeScaleUpdateResult> {
	return synchronizeGrid(await setBrowseAgeScale(scale));
}

export async function restoreDefaultBrowseAgeScale(): Promise<BrowseAgeScaleUpdateResult> {
	return synchronizeGrid(await resetBrowseAgeScale());
}
