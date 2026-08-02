import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readCacheEntryMock, writeCacheEntryMock } = vi.hoisted(() => ({
	readCacheEntryMock: vi.fn(),
	writeCacheEntryMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("./cache-manager", () => ({
	readCacheEntry: readCacheEntryMock,
	writeCacheEntry: writeCacheEntryMock,
}));

import type { TapProfile } from "$lib/model/interest/tap-profile";
import type { ViewerProfile, ViewPreview } from "$lib/model/interest/views";
import {
	readCachedTaps,
	readCachedViews,
	writeCachedTaps,
	writeCachedViews,
} from "./interest-cache";

const tap: TapProfile = {
	distance: null,
	profileImageMediaHash: null,
	isFavorite: false,
	profileId: 1,
	displayName: "Profile 1",
	timestamp: 1_710_000_000_000,
	tapType: 0,
	lastOnline: null,
	isBoosting: false,
	isMutual: false,
	rightNowType: "",
	isViewable: true,
};

const profile: ViewerProfile = {
	distance: null,
	profileImageMediaHash: null,
	isFavorite: false,
	lastViewed: 1_710_000_000_000,
	isSecretAdmirer: false,
	viewedCount: { totalCount: 1, maxDisplayCount: 99 },
	profileId: 2,
	displayName: "Profile 2",
	onlineUntil: null,
};

const preview: ViewPreview = {
	distance: null,
	profileImageMediaHash: null,
	isFavorite: false,
	lastViewed: 1_710_000_000_000,
	isSecretAdmirer: true,
	viewedCount: { totalCount: 3, maxDisplayCount: 99 },
};

beforeEach(() => {
	readCacheEntryMock.mockReset();
	writeCacheEntryMock.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("interest cache", () => {
	it("validates and unwraps account-scoped tap snapshots", async () => {
		readCacheEntryMock.mockImplementation(
			(
				_accountId: number,
				_kind: string,
				_key: string,
				parse: (value: unknown) => unknown,
			) =>
				Promise.resolve(parse({ version: 1, profiles: [tap], updatedAt: 123 })),
		);

		await expect(readCachedTaps(99)).resolves.toEqual({ profiles: [tap] });
		expect(readCacheEntryMock).toHaveBeenCalledWith(
			99,
			"taps",
			"received",
			expect.any(Function),
		);
	});

	it("persists validated tap and view snapshots with metadata", async () => {
		vi.spyOn(Date, "now").mockReturnValue(456);

		await writeCachedTaps(99, { profiles: [tap] });
		await writeCachedViews(99, { profiles: [profile], previews: [preview] });

		expect(writeCacheEntryMock).toHaveBeenNthCalledWith(
			1,
			99,
			"taps",
			"received",
			{ version: 1, profiles: [tap], updatedAt: 456 },
		);
		expect(writeCacheEntryMock).toHaveBeenNthCalledWith(
			2,
			99,
			"views",
			"received",
			{
				version: 1,
				profiles: [profile],
				previews: [preview],
				updatedAt: 456,
			},
		);
	});

	it("returns null when no view snapshot exists", async () => {
		readCacheEntryMock.mockResolvedValue(null);
		await expect(readCachedViews(99)).resolves.toBeNull();
	});
});
