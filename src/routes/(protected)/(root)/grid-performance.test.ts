import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProfiles } from "$lib/api/profile";
import {
	mergeResolvedGridProfiles,
	resolvePartialBatch,
	type FullGridProfile,
	type GridProfile,
} from "./grid";

vi.mock("$lib/api/profile", () => ({
	getProfiles: vi.fn(async () => [
		{ profileId: 1, displayName: "One", distance: 100, medias: [] },
		{ profileId: 2, displayName: "Two", distance: 200, medias: [] },
	]),
}));

beforeEach(() => {
	vi.mocked(getProfiles).mockClear();
});

describe("mergeResolvedGridProfiles", () => {
	it("updates and removes grid entries in one pass while preserving order", () => {
		const items: GridProfile[] = [
			{ type: "partial", id: 1, batchIndex: 0 },
			{ type: "partial", id: 2, batchIndex: 0 },
			{
				type: "full",
				id: 3,
				displayName: "Three",
				distance: null,
				profilePhotosHashes: null,
				unread: null,
			},
		];

		const merged = mergeResolvedGridProfiles({
			items,
			requestedIds: [1, 2],
			resolvedProfiles: [fullProfile(1)],
		});

		expect(merged).toEqual([
			fullProfile(1),
			{
				type: "full",
				id: 3,
				displayName: "Three",
				distance: null,
				profilePhotosHashes: null,
				unread: null,
			},
		]);
	});
});

describe("resolvePartialBatch", () => {
	it("skips network requests when no profile ids need resolving", async () => {
		const profiles = await resolvePartialBatch([]);

		expect(getProfiles).not.toHaveBeenCalled();
		expect(profiles).toEqual([]);
	});

	it("deduplicates network requests and preserves requested order", async () => {
		const profiles = await resolvePartialBatch([2, 1, 2]);

		expect(getProfiles).toHaveBeenCalledWith([2, 1]);
		expect(profiles.map((profile) => profile.id)).toEqual([2, 1]);
	});
});

function fullProfile(id: number): FullGridProfile {
	return {
		type: "full",
		id,
		displayName: `Profile ${id}`,
		distance: null,
		profilePhotosHashes: null,
		unread: null,
	};
}
