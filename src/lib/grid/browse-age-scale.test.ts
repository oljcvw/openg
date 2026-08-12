import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultFilters } from "$lib/components/filters/filters";

const { invalidateMock, setBrowseAgeScaleMock, syncMock } = vi.hoisted(() => ({
	invalidateMock: vi.fn(),
	setBrowseAgeScaleMock: vi.fn(),
	syncMock: vi.fn(),
}));

vi.mock("$lib/app-data/preferences.svelte", () => ({
	resetBrowseAgeScale: vi.fn(),
	setBrowseAgeScale: setBrowseAgeScaleMock,
}));
vi.mock("$lib/grid/grid-state.svelte", () => ({
	gridState: {
		filters: { sync: syncMock },
		invalidate: invalidateMock,
	},
}));

import { applyBrowseAgeScale } from "./browse-age-scale";

function updateResult(ageEnabled: boolean, ageSelectionClamped: boolean) {
	return {
		ageSelectionClamped,
		gridSearchFilters: {
			...defaultFilters,
			ageEnabled,
			age: [25, 55] as [number, number],
		},
		previousAge: [18, 102] as [number, number],
		nextAge: [25, 55] as [number, number],
		scale: { min: 25, max: 55 },
	};
}

beforeEach(() => {
	invalidateMock.mockReset();
	setBrowseAgeScaleMock.mockReset();
	syncMock.mockReset();
});

describe("Browse age scale synchronization", () => {
	it("invalidates stale Browse results when an active age selection is clamped", async () => {
		const result = updateResult(true, true);
		setBrowseAgeScaleMock.mockResolvedValue(result);

		await expect(applyBrowseAgeScale(result.scale)).resolves.toBe(result);

		expect(syncMock).toHaveBeenCalledWith(result.gridSearchFilters);
		expect(invalidateMock).toHaveBeenCalledOnce();
	});

	it.each([
		{ ageEnabled: false, ageSelectionClamped: true },
		{ ageEnabled: true, ageSelectionClamped: false },
	])(
		"does not invalidate when the effective query is unchanged",
		async (state) => {
			const result = updateResult(state.ageEnabled, state.ageSelectionClamped);
			setBrowseAgeScaleMock.mockResolvedValue(result);

			await applyBrowseAgeScale(result.scale);

			expect(syncMock).toHaveBeenCalledWith(result.gridSearchFilters);
			expect(invalidateMock).not.toHaveBeenCalled();
		},
	);
});
