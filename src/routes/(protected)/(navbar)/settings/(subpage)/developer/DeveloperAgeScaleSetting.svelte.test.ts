// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type BrowseAgeScale,
	defaultFilters,
} from "$lib/components/filters/filters";

const { applyBrowseAgeScaleMock } = vi.hoisted(() => ({
	applyBrowseAgeScaleMock: vi.fn(),
}));

vi.mock("$lib/app-data/preferences.svelte", () => ({
	getBrowseAgeScaleSnapshot: () => ({ min: 40, max: 50 }),
}));

vi.mock("$lib/grid/browse-age-scale", () => ({
	applyBrowseAgeScale: applyBrowseAgeScaleMock,
}));

import DeveloperAgeScaleSetting from "./DeveloperAgeScaleSetting.svelte";

function resultFor(scale: BrowseAgeScale) {
	return {
		ageSelectionClamped: false,
		gridSearchFilters: { ...defaultFilters, age: [scale.min, scale.max] },
		previousAge: [40, 50],
		nextAge: [scale.min, scale.max],
		scale,
	};
}

beforeEach(() => {
	applyBrowseAgeScaleMock
		.mockReset()
		.mockImplementation((scale) => Promise.resolve(resultFor(scale)));
});

afterEach(cleanup);

describe("DeveloperAgeScaleSetting", () => {
	it("raises and announces the maximum when minimum crosses it", async () => {
		const view = render(DeveloperAgeScaleSetting);
		const minimum = view.getByLabelText("Minimum");
		const maximum = view.getByLabelText("Maximum");

		await fireEvent.change(minimum, { target: { value: "60" } });

		await waitFor(() =>
			expect(applyBrowseAgeScaleMock).toHaveBeenCalledWith({
				min: 60,
				max: 60,
			}),
		);
		expect((maximum as HTMLInputElement).value).toBe("60");
		expect(
			await view.findByText("Maximum adjusted to 60 to match minimum."),
		).toBeTruthy();
		expect(
			maximum.parentElement?.classList.contains("correction-feedback"),
		).toBe(true);
	});

	it("synchronizes And over with the maximum", async () => {
		const view = render(DeveloperAgeScaleSetting);
		const andOver = view.getByLabelText("And over");
		const maximum = view.getByLabelText("Maximum");

		await fireEvent.click(andOver);

		await waitFor(() =>
			expect(applyBrowseAgeScaleMock).toHaveBeenCalledWith({
				min: 40,
				max: 102,
			}),
		);
		expect((maximum as HTMLInputElement).value).toBe("102");
		expect(
			await view.findByText("Maximum adjusted to 102 for And over."),
		).toBeTruthy();
	});
});
