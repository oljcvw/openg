import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readCacheEntryMock, writeCacheEntryMock } = vi.hoisted(() => ({
	readCacheEntryMock: vi.fn(),
	writeCacheEntryMock: vi.fn(),
}));

vi.mock("$lib/api/account-caches", () => ({
	registerAccountCache: vi.fn(),
}));
vi.mock("$lib/app-data/profile-cache", () => ({
	getProfileCacheAccount: () => 42,
}));
vi.mock("$lib/app-data/cache-manager", () => ({
	readCacheEntry: readCacheEntryMock,
	removeCacheEntry: vi.fn(),
	writeCacheEntry: writeCacheEntryMock,
}));
vi.mock(".", () => ({
	existsAppDataFile: vi.fn(() => Promise.resolve(false)),
	readAppDataFile: vi.fn(),
	removeAppDataFile: vi.fn(),
}));

import {
	clearGridDiskCacheMemory,
	normalizePersistedGridQuery,
	parseGridCache,
	readCachedGrid,
	writeCachedGrid,
} from "$lib/app-data/grid-cache";

beforeEach(() => {
	clearGridDiskCacheMemory();
	readCacheEntryMock.mockReset().mockResolvedValue(null);
	writeCacheEntryMock.mockReset().mockResolvedValue(undefined);
});

describe("Browse cache schema", () => {
	it("adds defaults for a new cache", () => {
		expect(parseGridCache({})).toEqual({ version: 1, accounts: {} });
	});

	it("rejects unknown cache versions", () => {
		expect(() => parseGridCache({ version: 2, accounts: {} })).toThrow();
	});

	it("hydrates legacy null optional query properties without deleting profiles", () => {
		const parsed = parseGridCache({
			version: 1,
			accounts: {
				"42": {
					legacy: {
						query: { nearbyGeoHash: "gc7x12345678", onlineOnly: null },
						items: [
							{
								type: "lazy",
								id: 7,
								unread: null,
								isVisiting: false,
							},
						],
						nextPage: null,
						updatedAt: 1,
					},
				},
			},
		});

		expect(parsed.accounts["42"]?.legacy?.query).toEqual({
			nearbyGeoHash: "gc7x12345678",
		});
		expect(parsed.accounts["42"]?.legacy?.items).toHaveLength(1);
	});

	it("omits absent query options before MessagePack encoding", () => {
		const query = normalizePersistedGridQuery({
			nearbyGeoHash: "gc7x12345678",
			onlineOnly: undefined,
		});
		expect(decode(encode(query))).toEqual({ nearbyGeoHash: "gc7x12345678" });
	});

	it("re-keys normalized queries on hydration and keeps the newest collision", async () => {
		readCacheEntryMock.mockImplementation(
			(
				_accountId: number,
				_kind: string,
				_key: string,
				parse: (value: unknown) => unknown,
			) =>
				Promise.resolve(
					parse({
						legacy: {
							query: {
								nearbyGeoHash: "gc7x12345678",
								onlineOnly: null,
							},
							items: [{ type: "lazy", id: 7, unread: null, isVisiting: false }],
							nextPage: null,
							updatedAt: 100,
						},
						canonical: {
							query: { nearbyGeoHash: "gc7x12345678" },
							items: [{ type: "lazy", id: 8, unread: null, isVisiting: false }],
							nextPage: null,
							updatedAt: 200,
						},
					}),
				),
		);

		await expect(
			readCachedGrid({ nearbyGeoHash: "gc7x12345678" }, 250),
		).resolves.toMatchObject({
			query: { nearbyGeoHash: "gc7x12345678" },
			items: [expect.objectContaining({ id: 8 })],
			updatedAt: 200,
		});
	});

	it("persists hydrated legacy entries under canonical query keys on the next write", async () => {
		readCacheEntryMock.mockImplementation(
			(
				_accountId: number,
				_kind: string,
				_key: string,
				parse: (value: unknown) => unknown,
			) =>
				Promise.resolve(
					parse({
						legacy: {
							query: {
								nearbyGeoHash: "gc7x12345678",
								onlineOnly: null,
							},
							items: [],
							nextPage: null,
							updatedAt: 100,
						},
					}),
				),
		);

		await writeCachedGrid(
			{
				query: { nearbyGeoHash: "u10j12345678" },
				items: [],
				nextPage: null,
			},
			200,
		);

		const persisted = writeCacheEntryMock.mock.calls[0]?.[3] as Record<
			string,
			unknown
		>;
		expect(Object.keys(persisted)).toEqual([
			JSON.stringify({ nearbyGeoHash: "gc7x12345678" }),
			JSON.stringify({ nearbyGeoHash: "u10j12345678" }),
		]);
		expect(persisted).not.toHaveProperty("legacy");
	});
});
