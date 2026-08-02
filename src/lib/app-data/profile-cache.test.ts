import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	existsAppDataFileMock,
	readAppDataFileMock,
	readCacheEntryMock,
	removeAppDataFileMock,
	writeAppDataFileAtomicMock,
	writeCacheEntryMock,
} = vi.hoisted(() => ({
	existsAppDataFileMock: vi.fn(),
	readAppDataFileMock: vi.fn(),
	readCacheEntryMock: vi.fn(),
	removeAppDataFileMock: vi.fn(),
	writeAppDataFileAtomicMock: vi.fn(),
	writeCacheEntryMock: vi.fn(),
}));

vi.mock(".", () => ({
	existsAppDataFile: existsAppDataFileMock,
	readAppDataFile: readAppDataFileMock,
	removeAppDataFile: removeAppDataFileMock,
	writeAppDataFileAtomic: writeAppDataFileAtomicMock,
}));
vi.mock("./cache-manager", () => ({
	readCacheEntry: readCacheEntryMock,
	removeCacheEntry: vi.fn(),
	writeCacheEntry: writeCacheEntryMock,
}));

import {
	clearProfileDiskCacheMemory,
	parseProfileCache,
	readCachedProfile,
	setProfileCacheAccount,
} from "$lib/app-data/profile-cache";
import { buildFullProfile } from "$lib/demo/mock/grid";
import { profileSeed } from "$lib/demo/mock/profiles";

beforeEach(() => {
	clearProfileDiskCacheMemory();
	existsAppDataFileMock.mockReset().mockResolvedValue(false);
	readAppDataFileMock.mockReset();
	readCacheEntryMock.mockReset().mockResolvedValue(null);
	removeAppDataFileMock.mockReset().mockResolvedValue(undefined);
	writeAppDataFileAtomicMock.mockReset().mockResolvedValue(undefined);
	writeCacheEntryMock.mockReset().mockResolvedValue(undefined);
});

describe("profile cache schema", () => {
	it("adds defaults for a new cache", () => {
		expect(parseProfileCache({})).toEqual({ version: 1, accounts: {} });
	});

	it("rejects cache entries without account isolation", () => {
		expect(() =>
			parseProfileCache({ version: 1, profiles: { "123": {} } }),
		).not.toThrow();
		expect(parseProfileCache({ version: 1, profiles: { "123": {} } })).toEqual({
			version: 1,
			accounts: {},
		});
	});

	it("rejects unknown cache versions", () => {
		expect(() => parseProfileCache({ version: 2, accounts: {} })).toThrow();
	});

	it("preserves other accounts while migrating the active account", async () => {
		const activeProfile = buildFullProfile(profileSeed(101));
		const otherProfile = buildFullProfile(profileSeed(202));
		existsAppDataFileMock.mockResolvedValue(true);
		readAppDataFileMock.mockResolvedValue(
			encode({
				version: 1,
				accounts: {
					"7001": {
						[activeProfile.profileId]: {
							profile: activeProfile,
							updatedAt: 1_000,
						},
					},
					"7002": {
						[otherProfile.profileId]: {
							profile: otherProfile,
							updatedAt: 2_000,
						},
					},
				},
			}),
		);
		setProfileCacheAccount(7001);

		await readCachedProfile(activeProfile.profileId);

		expect(writeCacheEntryMock).toHaveBeenCalledWith(
			7001,
			"profile",
			String(activeProfile.profileId),
			expect.objectContaining({ profile: activeProfile, updatedAt: 1_000 }),
		);
		expect(removeAppDataFileMock).not.toHaveBeenCalledWith(
			"profile-cache.data",
		);
		const migrated = parseProfileCache(
			decode(writeAppDataFileAtomicMock.mock.calls[0][1]),
		);
		expect(migrated.accounts).toEqual({
			"7002": {
				[otherProfile.profileId]: {
					profile: otherProfile,
					updatedAt: 2_000,
				},
			},
		});
	});
});
