import { isEqual } from "lodash-es";

import { showErrorToast } from "$lib/api/error";
import {
	getBrowseAgeScaleSnapshot,
	getPreferences,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import {
	clampAgeRange,
	defaultFilters,
	type GridSearchFilters,
} from "$lib/components/filters/filters";

export class GridSearchFiltersState {
	value: GridSearchFilters | null = $state(null);
	onRefresh: () => void;
	ready: Promise<void>;

	constructor({ onRefresh }: { onRefresh: () => void }) {
		this.onRefresh = onRefresh;
		this.ready = this.#load();
	}

	set(gridSearchFilters: Partial<GridSearchFilters>) {
		const oldValue = this.value;
		const newValue = this.#normalize(
			Object.assign({}, oldValue ?? defaultFilters, gridSearchFilters),
		);
		if (!isEqual(oldValue, newValue)) {
			this.value = newValue;
			void this.#save();
			this.onRefresh();
		}
	}

	resetFilters() {
		this.value = this.#normalize(defaultFilters);
		void this.#save();
	}

	reset() {
		this.value = this.#normalize(defaultFilters);
	}

	sync(gridSearchFilters: GridSearchFilters) {
		this.value = this.#normalize(gridSearchFilters);
	}

	async #load() {
		try {
			const { gridSearchFilters } = await getPreferences();
			this.value = this.#normalize(gridSearchFilters ?? defaultFilters);
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to load filters",
				error,
			});
		}
	}

	#normalize(gridSearchFilters: GridSearchFilters): GridSearchFilters {
		return {
			...gridSearchFilters,
			age: clampAgeRange(gridSearchFilters.age, getBrowseAgeScaleSnapshot()),
		};
	}

	async #save() {
		try {
			if (this.value !== null) {
				await setPreferences({ gridSearchFilters: this.value });
			}
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to update filters",
				error,
			});
		}
	}
}
