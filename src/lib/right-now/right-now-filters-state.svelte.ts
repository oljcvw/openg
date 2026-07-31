import { isEqual } from "lodash-es";

import { showErrorToast } from "$lib/api/error";
import {
	getPreferences,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import {
	defaultRightNowFilters,
	type RightNowFilters,
	rightNowFiltersSchema,
} from "$lib/components/filters/filters";

type FilterPersistence = {
	load(): Promise<RightNowFilters | undefined>;
	save(value: RightNowFilters): Promise<void>;
};

const defaultPersistence: FilterPersistence = {
	async load() {
		return (await getPreferences()).rightNowFilters;
	},
	async save(value) {
		await setPreferences({ rightNowFilters: value });
	},
};

export class RightNowSearchFiltersState {
	value: RightNowFilters | null = $state(null);
	ready: Promise<void>;

	#changeVersion = 0;
	#onRefresh: () => void;
	#persistence: FilterPersistence;

	constructor({
		onRefresh,
		persistence = defaultPersistence,
	}: {
		onRefresh: () => void;
		persistence?: FilterPersistence;
	}) {
		this.#onRefresh = onRefresh;
		this.#persistence = persistence;
		this.ready = this.#load();
	}

	set(values: Partial<RightNowFilters>) {
		const oldValue = this.value ?? defaultRightNowFilters;
		const newValue = rightNowFiltersSchema.parse({
			...oldValue,
			...values,
		});
		if (isEqual(oldValue, newValue)) return;

		this.#changeVersion += 1;
		this.value = newValue;
		void this.#save(newValue);
		this.#onRefresh();
	}

	resetFilters() {
		this.set(defaultRightNowFilters);
	}

	reset() {
		this.#changeVersion += 1;
		this.value = { ...defaultRightNowFilters };
	}

	async #load() {
		const version = this.#changeVersion;
		try {
			const saved = await this.#persistence.load();
			if (version === this.#changeVersion) {
				this.value = rightNowFiltersSchema.parse(saved ?? {});
			}
		} catch (error) {
			console.error(error);
			if (version === this.#changeVersion) {
				this.value = { ...defaultRightNowFilters };
			}
			showErrorToast({ label: "Failed to load Right Now filters", error });
		}
	}

	async #save(value: RightNowFilters) {
		try {
			await this.#persistence.save(value);
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to update Right Now filters", error });
		}
	}
}
