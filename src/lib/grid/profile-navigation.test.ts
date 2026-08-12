import { describe, expect, it } from "vitest";

import {
	getAdjacentProfileIds,
	getUniqueProfileIds,
	isProfileSwipeInteractiveTarget,
	selectProfileForHorizontalSwipe,
	selectProfileForNavigationKey,
} from "./profile-navigation";

describe("getUniqueProfileIds", () => {
	it("keeps first-seen grid order", () => {
		expect(
			getUniqueProfileIds([{ id: 10 }, { id: 20 }, { id: 10 }, { id: 30 }]),
		).toEqual([10, 20, 30]);
	});
});

describe("getAdjacentProfileIds", () => {
	it("selects previous and next profiles from unique grid order", () => {
		expect(
			getAdjacentProfileIds(
				[{ id: 10 }, { id: 20 }, { id: 10 }, { id: 30 }],
				20,
			),
		).toEqual({
			nextProfileId: 30,
			previousProfileId: 10,
		});
	});

	it("returns null at boundaries and outside the grid", () => {
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 10)).toEqual({
			nextProfileId: 20,
			previousProfileId: null,
		});
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 20)).toEqual({
			nextProfileId: null,
			previousProfileId: 10,
		});
		expect(getAdjacentProfileIds([{ id: 10 }, { id: 20 }], 30)).toEqual({
			nextProfileId: null,
			previousProfileId: null,
		});
	});
});

describe("selectProfileForHorizontalSwipe", () => {
	const adjacent = {
		nextProfileId: 30,
		previousProfileId: 10,
		startX: 100,
	};

	it("selects next for left swipes and previous for right swipes", () => {
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				deltaX: -100,
				deltaY: 10,
				elapsedMs: 300,
			}),
		).toEqual({ direction: "next", profileId: 30 });
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				deltaX: 100,
				deltaY: 10,
				elapsedMs: 300,
			}),
		).toEqual({ direction: "previous", profileId: 10 });
	});

	it("accepts a short, fast horizontal flick", () => {
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				deltaX: -40,
				deltaY: 4,
				elapsedMs: 50,
			}),
		).toEqual({ direction: "next", profileId: 30 });
	});

	it("ignores short, slow, or mostly vertical gestures", () => {
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				deltaX: -40,
				deltaY: 0,
				elapsedMs: 500,
			}),
		).toBeNull();
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				deltaX: -100,
				deltaY: 90,
				elapsedMs: 100,
			}),
		).toBeNull();
	});

	it("leaves the Android system-back edge unclaimed", () => {
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				startX: 12,
				deltaX: 100,
				deltaY: 0,
				elapsedMs: 100,
			}),
		).toBeNull();
	});

	it("reports direction even when the loaded grid has no neighbor", () => {
		expect(
			selectProfileForHorizontalSwipe({
				...adjacent,
				nextProfileId: null,
				deltaX: -100,
				deltaY: 0,
				elapsedMs: 100,
			}),
		).toEqual({ direction: "next", profileId: null });
	});
});

describe("selectProfileForNavigationKey", () => {
	it("keeps arrow-key navigation disabled with hidden controls", () => {
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: true,
				canNavigatePrevious: true,
				enabled: false,
				key: "ArrowLeft",
			}),
		).toBeNull();
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: true,
				canNavigatePrevious: true,
				enabled: false,
				key: "ArrowRight",
			}),
		).toBeNull();
	});

	it("maps available arrow keys when accessible controls are enabled", () => {
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: true,
				canNavigatePrevious: true,
				enabled: true,
				key: "ArrowLeft",
			}),
		).toBe("previous");
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: true,
				canNavigatePrevious: true,
				enabled: true,
				key: "ArrowRight",
			}),
		).toBe("next");
	});

	it("ignores unavailable neighbors and unrelated keys", () => {
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: false,
				canNavigatePrevious: false,
				enabled: true,
				key: "ArrowRight",
			}),
		).toBeNull();
		expect(
			selectProfileForNavigationKey({
				canNavigateNext: true,
				canNavigatePrevious: true,
				enabled: true,
				key: "Enter",
			}),
		).toBeNull();
	});
});

describe("isProfileSwipeInteractiveTarget", () => {
	it("allows the inline photo surface to own profile gestures", () => {
		const surface = document.createElement("div");
		surface.dataset.profileSwipeSurface = "";
		const link = document.createElement("a");
		const image = document.createElement("img");
		link.appendChild(image);
		surface.appendChild(link);

		expect(isProfileSwipeInteractiveTarget(image)).toBe(false);
	});

	it("protects controls and the full-screen photo viewer", () => {
		const button = document.createElement("button");
		const viewer = document.createElement("div");
		viewer.className = "pswp";
		const image = document.createElement("img");
		viewer.appendChild(image);

		expect(isProfileSwipeInteractiveTarget(button)).toBe(true);
		expect(isProfileSwipeInteractiveTarget(image)).toBe(true);
	});
});
