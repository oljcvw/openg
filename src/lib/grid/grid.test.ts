import { afterEach, describe, expect, it, vi } from "vitest";

import { resetNowForTesting, setNowForTesting } from "$lib/util/clock";
import {
	getCachedProfile,
	getGrid,
	type RenderedGridProfile,
	resolveLazyProfiles,
	setCachedProfile,
} from "./grid";

const { getCascadeV4, getProfiles } = vi.hoisted(() => ({
	getCascadeV4: vi.fn(),
	getProfiles: vi.fn(),
}));

vi.mock("$lib/api/browse/grid", () => ({ getCascadeV4 }));
vi.mock("$lib/api/users/profiles", () => ({ getProfiles }));

afterEach(() => {
	resetNowForTesting();
	getProfiles.mockReset();
	getCascadeV4.mockReset();
});

describe("cascade profiles", () => {
	it("renders full and partial cards without profile requests", async () => {
		getCascadeV4.mockResolvedValue({
			items: [
				{
					type: "full_profile_v1",
					data: {
						profileId: 1,
						displayName: "Full",
						primaryImageUrl: "https://cdn/one",
						isVisiting: false,
						rightNow: "NOT_ACTIVE",
					},
				},
				{
					type: "partial_profile_v1",
					data: {
						profileId: 2,
						displayName: "Partial",
						primaryImageUrl: "https://cdn/two",
						isVisiting: false,
						rightNow: "NOT_ACTIVE",
					},
				},
			],
			nextPage: null,
			shuffled: false,
		});

		const result = await getGrid({ nearbyGeoHash: "gc7x" });

		expect(result.items).toMatchObject([
			{ type: "rendered", id: 1, displayName: "Full" },
			{ type: "rendered", id: 2, displayName: "Partial" },
		]);
		expect(getProfiles).not.toHaveBeenCalled();
	});
});

describe("lazy profile batching", () => {
	it("resolves many lazy cards with one profile request", async () => {
		getProfiles.mockResolvedValue([
			{
				profileId: 1,
				displayName: "Ada",
				distance: 100,
				medias: [{ mediaHash: "a" }],
				onlineUntil: null,
				isFavorite: false,
				rightNow: "NOT_ACTIVE",
				lastChatTimestamp: null,
			},
		]);

		const result = await resolveLazyProfiles([
			{ type: "lazy", id: 1, unread: 2, isVisiting: true },
			{ type: "lazy", id: 2, unread: 0, isVisiting: false },
		]);

		expect(getProfiles).toHaveBeenCalledOnce();
		expect(getProfiles).toHaveBeenCalledWith([1, 2]);
		expect(result.get(1)).toMatchObject({
			type: "rendered",
			id: 1,
			unread: 2,
			isVisiting: true,
		});
		expect(result.has(2)).toBe(false);
	});
});

function rendered(id: number): RenderedGridProfile {
	return {
		type: "rendered",
		id,
		displayName: "Ada",
		distance: 100,
		profilePhotosHashes: ["a"],
		unread: 0,
		onlineUntil: null,
		isFavorite: false,
		isRightNow: false,
		isVisiting: false,
		hasChattedInLast24Hrs: false,
	};
}

describe("grid profile cache TTL", () => {
	it("returns a cached profile within the TTL and drops it after", () => {
		let clock = 1_000;
		setNowForTesting(() => clock);

		setCachedProfile(rendered(1));
		expect(getCachedProfile(1)).toEqual(rendered(1));

		clock += 59_999;
		expect(getCachedProfile(1)).toEqual(rendered(1));

		clock += 1;
		expect(getCachedProfile(1)).toBeNull();
	});

	it("returns null for an unknown profile", () => {
		expect(getCachedProfile(999)).toBeNull();
	});
});
