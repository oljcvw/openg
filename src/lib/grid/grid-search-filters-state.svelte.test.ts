import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultFilters } from "$lib/components/filters/filters";

const { getPreferencesMock, setPreferencesMock } = vi.hoisted(() => ({
	getPreferencesMock: vi.fn(),
	setPreferencesMock: vi.fn(),
}));

vi.mock("$lib/api/error", () => ({ showErrorToast: vi.fn() }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getBrowseAgeScaleSnapshot: () => ({ min: 25, max: 55 }),
	getPreferences: getPreferencesMock,
	setPreferences: setPreferencesMock,
}));

import { GridSearchFiltersState } from "./grid-search-filters-state.svelte";

beforeEach(() => {
	getPreferencesMock.mockReset().mockResolvedValue({
		gridSearchFilters: { ...defaultFilters },
	});
	setPreferencesMock.mockReset().mockResolvedValue(undefined);
});

describe("GridSearchFiltersState age scale", () => {
	it("normalizes loaded and newly applied ages to the configured scale", async () => {
		const onRefresh = vi.fn();
		const state = new GridSearchFiltersState({ onRefresh });
		await state.ready;

		expect(state.value?.age).toEqual([25, 55]);
		state.set({ age: [18, 102] });

		expect(state.value).toMatchObject({ age: [25, 55], ageEnabled: false });
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it("refreshes when an in-scale selection changes", async () => {
		const onRefresh = vi.fn();
		const state = new GridSearchFiltersState({ onRefresh });
		await state.ready;

		state.set({ age: [30, 45], ageEnabled: true });

		expect(state.value).toMatchObject({ age: [30, 45], ageEnabled: true });
		expect(onRefresh).toHaveBeenCalledOnce();
	});
});
