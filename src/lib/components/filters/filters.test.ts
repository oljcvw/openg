import { describe, expect, it } from "vitest";

import {
	browseAgeScaleLabel,
	browseAgeScaleSchema,
	clampAgeRange,
	defaultFilters,
	FilterAcceptNSFWPics,
	filterAcceptNSFWPicsSchema,
	filterAgeSchema,
	FilterBodyType,
	filterGendersSchema,
	filterHeightSchema,
	FilterLookingFor,
	FilterPosition,
	filterPositionSchema,
	filterWeightSchema,
	gridSearchFiltersSchema,
	isCustomBrowseAgeScale,
} from "$lib/components/filters/filters";

describe("grid search filter schemas", () => {
	it("accepts the default filter state", () => {
		expect(gridSearchFiltersSchema.parse(defaultFilters)).toEqual(
			defaultFilters,
		);
	});

	it("enforces filter range boundaries", () => {
		expect(filterAgeSchema.safeParse([18, 102]).success).toBe(true);
		expect(filterAgeSchema.safeParse([17, 102]).success).toBe(false);
		expect(filterHeightSchema.safeParse([120, 242]).success).toBe(true);
		expect(filterHeightSchema.safeParse([119, 242]).success).toBe(false);
		expect(filterWeightSchema.safeParse([40, 273]).success).toBe(true);
		expect(filterWeightSchema.safeParse([40, 274]).success).toBe(false);
	});

	it("accepts not-specified aliases for filters that expose them", () => {
		expect(filterPositionSchema.parse([FilterPosition.NotSpecified])).toEqual([
			FilterPosition.NotSpecified,
		]);
		expect(FilterBodyType.NotSpecified).toBe(-1);
		expect(FilterLookingFor.NotSpecified).toBe(-1);
		expect(FilterAcceptNSFWPics.NotSpecified).toBe(-1);
		expect(
			filterAcceptNSFWPicsSchema.parse([FilterAcceptNSFWPics.NotSpecified]),
		).toEqual([FilterAcceptNSFWPics.NotSpecified]);
	});

	it("accepts not-specified (-1) alongside gender ids", () => {
		expect(filterGendersSchema.parse([-1, 42])).toEqual([-1, 42]);
		expect(filterGendersSchema.safeParse([-2]).success).toBe(false);
	});
});

describe("Browse age slider scale", () => {
	it("keeps the protocol range while validating a narrower display scale", () => {
		expect(browseAgeScaleSchema.parse({ min: 25, max: 55 })).toEqual({
			min: 25,
			max: 55,
		});
		expect(browseAgeScaleSchema.safeParse({ min: 102, max: 102 }).success).toBe(
			false,
		);
		expect(browseAgeScaleSchema.safeParse({ min: 60, max: 55 }).success).toBe(
			false,
		);
		expect(filterAgeSchema.safeParse([18, 102]).success).toBe(true);
	});

	it("clamps and orders selections inside the configured scale", () => {
		expect(clampAgeRange([18, 102], { min: 25, max: 55 })).toEqual([25, 55]);
		expect(clampAgeRange([70, 20], { min: 25, max: 55 })).toEqual([25, 55]);
		expect(clampAgeRange([40, 40], { min: 40, max: 40 })).toEqual([40, 40]);
	});

	it("labels custom and open-ended scales", () => {
		expect(isCustomBrowseAgeScale({ min: 18, max: 102 })).toBe(false);
		expect(isCustomBrowseAgeScale({ min: 25, max: 102 })).toBe(true);
		expect(browseAgeScaleLabel({ min: 25, max: 102 })).toBe("25–and over");
	});
});
