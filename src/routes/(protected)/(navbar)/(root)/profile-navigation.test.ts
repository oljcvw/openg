import { describe, expect, it } from "vitest";

import {
	getAdjacentProfileIds,
	getUniqueGridProfiles,
	selectProfileIdForHorizontalSwipe,
} from "$lib/grid/profile-navigation";

describe("getUniqueGridProfiles", () => {
	it("keeps the first occurrence from the sorted grid list", () => {
		const profiles = [
			{ id: 1, source: "first" },
			{ id: 2, source: "first" },
			{ id: 1, source: "duplicate" },
			{ id: 3, source: "first" },
		];

		expect(getUniqueGridProfiles(profiles)).toEqual([
			{ id: 1, source: "first" },
			{ id: 2, source: "first" },
			{ id: 3, source: "first" },
		]);
	});
});

describe("getAdjacentProfileIds", () => {
	it("selects previous and next profiles from the unique grid order", () => {
		const navigation = getAdjacentProfileIds(
			[{ id: 10 }, { id: 20 }, { id: 10 }, { id: 30 }],
			20,
		);

		expect(navigation).toEqual({
			nextProfileId: 30,
			previousProfileId: 10,
		});
	});

	it("returns null neighbors at grid edges", () => {
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 10)).toEqual({
			nextProfileId: 20,
			previousProfileId: null,
		});
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 20)).toEqual({
			nextProfileId: null,
			previousProfileId: 10,
		});
	});

	it("returns null neighbors when the current profile is not in the grid", () => {
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 30)).toEqual({
			nextProfileId: null,
			previousProfileId: null,
		});
	});
});

describe("selectProfileIdForHorizontalSwipe", () => {
	it("selects next for left swipes and previous for right swipes", () => {
		expect(
			selectProfileIdForHorizontalSwipe({
				deltaX: -100,
				deltaY: 10,
				nextProfileId: 30,
				previousProfileId: 10,
			}),
		).toBe(30);
		expect(
			selectProfileIdForHorizontalSwipe({
				deltaX: 100,
				deltaY: 10,
				nextProfileId: 30,
				previousProfileId: 10,
			}),
		).toBe(10);
	});

	it("ignores short or mostly vertical gestures", () => {
		expect(
			selectProfileIdForHorizontalSwipe({
				deltaX: -40,
				deltaY: 0,
				nextProfileId: 30,
				previousProfileId: 10,
			}),
		).toBe(null);
		expect(
			selectProfileIdForHorizontalSwipe({
				deltaX: -100,
				deltaY: 90,
				nextProfileId: 30,
				previousProfileId: 10,
			}),
		).toBe(null);
	});

	it("does not select a missing neighbor", () => {
		expect(
			selectProfileIdForHorizontalSwipe({
				deltaX: -100,
				deltaY: 0,
				nextProfileId: null,
				previousProfileId: 10,
			}),
		).toBe(null);
	});
});
