import { encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	clearAlbumMediaCacheMock,
	clearAlbumPresetsMock,
	clearDirectMediaCacheMock,
	clearShortVideoCacheMock,
	existsAppDataFileMock,
	readAppDataFileMock,
	removeAppDataFileMock,
	writeAppDataFileAtomicMock,
} = vi.hoisted(() => ({
	clearAlbumMediaCacheMock: vi.fn(),
	clearAlbumPresetsMock: vi.fn(),
	clearDirectMediaCacheMock: vi.fn(),
	clearShortVideoCacheMock: vi.fn(),
	existsAppDataFileMock: vi.fn(),
	readAppDataFileMock: vi.fn(),
	removeAppDataFileMock: vi.fn(),
	writeAppDataFileAtomicMock: vi.fn(),
}));

vi.mock("$lib/albums/album-preset-store", () => ({
	clearAlbumPresets: clearAlbumPresetsMock,
}));

vi.mock("./album-media-cache", () => ({
	clearAlbumMediaCache: clearAlbumMediaCacheMock,
	getAlbumMediaCacheStats: vi.fn().mockResolvedValue({ byteLength: 0 }),
	subscribeAlbumMediaCacheStats: vi.fn(),
	trimAlbumMediaCache: vi.fn(),
}));
vi.mock("./direct-media-cache", () => ({
	clearDirectMediaCache: clearDirectMediaCacheMock,
}));
vi.mock("./short-video-cache", () => ({
	clearShortVideoCache: clearShortVideoCacheMock,
	getShortVideoCacheStats: vi.fn().mockResolvedValue({ byteLength: 0 }),
	subscribeShortVideoCacheStats: vi.fn(),
}));

vi.mock(".", () => ({
	existsAppDataFile: existsAppDataFileMock,
	readAppDataFile: readAppDataFileMock,
	removeAppDataFile: removeAppDataFileMock,
	writeAppDataFileAtomic: writeAppDataFileAtomicMock,
}));

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import {
	clearCacheManagerMemory,
	listCacheEntries,
	readCacheEntry,
	removeAccountCache,
	removeGenericAccountCache,
	setCacheLimitMb,
	subscribeCacheUsage,
	writeCacheEntry,
} from "$lib/app-data/cache-manager";

function installProfileManifest(lastAccessedAt: number): void {
	existsAppDataFileMock.mockResolvedValue(true);
	readAppDataFileMock.mockImplementation((path: string) =>
		Promise.resolve(
			encode(
				path === "cache-manifest.data"
					? {
							version: 1,
							entries: {
								'[7001,"profile","42"]': {
									accountId: 7001,
									kind: "profile",
									key: "42",
									path: "profile-42.data",
									sizeBytes: 16,
									lastAccessedAt,
								},
							},
						}
					: { value: "profile-42" },
			),
		),
	);
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	clearCacheManagerMemory();
	existsAppDataFileMock.mockReset().mockResolvedValue(false);
	readAppDataFileMock.mockReset();
	removeAppDataFileMock.mockReset().mockResolvedValue(undefined);
	writeAppDataFileAtomicMock.mockReset().mockResolvedValue(undefined);
	clearAlbumMediaCacheMock.mockReset().mockResolvedValue(undefined);
	clearAlbumPresetsMock.mockReset().mockResolvedValue(undefined);
	clearDirectMediaCacheMock.mockReset().mockResolvedValue(undefined);
	clearShortVideoCacheMock.mockReset().mockResolvedValue(undefined);
	activateAccountSession(7001);
});

describe("account-scoped native cache clearing", () => {
	it("targets only the requested account in every native media cache", async () => {
		await removeAccountCache(7001);
		expect(clearAlbumPresetsMock).toHaveBeenCalledWith(7001);
		expect(clearAlbumMediaCacheMock).toHaveBeenCalledWith(7001);
		expect(clearDirectMediaCacheMock).toHaveBeenCalledWith(7001);
		expect(clearShortVideoCacheMock).toHaveBeenCalledWith(7001);
	});

	it("still clears generic cache entries when a native cache clear fails", async () => {
		clearAlbumMediaCacheMock.mockRejectedValueOnce(new Error("native failed"));

		await expect(removeAccountCache(7001)).rejects.toThrow(
			"cleanup was incomplete",
		);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalled();
	});

	it("can clear only generic data after native account teardown", async () => {
		await removeGenericAccountCache(7001);
		expect(clearAlbumMediaCacheMock).not.toHaveBeenCalled();
		expect(clearAlbumPresetsMock).not.toHaveBeenCalled();
		expect(clearDirectMediaCacheMock).not.toHaveBeenCalled();
		expect(clearShortVideoCacheMock).not.toHaveBeenCalled();
	});
});

describe("cache write account fencing", () => {
	it("removes a file whose write finishes after account invalidation", async () => {
		const gate = deferred();
		writeAppDataFileAtomicMock.mockReturnValueOnce(gate.promise);
		const writing = writeCacheEntry(7001, "profile", "42", { value: true });
		await vi.waitFor(() =>
			expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce(),
		);
		const path = writeAppDataFileAtomicMock.mock.calls[0]![0] as string;

		invalidateAccountSession();
		gate.resolve();
		await writing;

		expect(removeAppDataFileMock).toHaveBeenCalledWith(path);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
	});

	it("does not start a write for an inactive account", async () => {
		invalidateAccountSession();

		await writeCacheEntry(7001, "inbox", "inbox", { value: true });

		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
	});
});

describe("non-evictable conversion state", () => {
	it("retains migration ledgers when byte-LRU pressure evicts ordinary cache data", async () => {
		await setCacheLimitMb(10);
		await writeCacheEntry(7001, "migration", "beta5-ledger", {
			version: 5,
		});
		const migrationPath = writeAppDataFileAtomicMock.mock.calls.at(-2)?.[0];
		await writeCacheEntry(7001, "profile", "large", {
			payload: "x".repeat(11 * 1024 * 1024),
		});
		const profilePath = writeAppDataFileAtomicMock.mock.calls.at(-2)?.[0];

		expect(removeAppDataFileMock).toHaveBeenCalledWith(profilePath);
		expect(removeAppDataFileMock).not.toHaveBeenCalledWith(migrationPath);
	});
});

describe("cache usage subscription", () => {
	it("routes initial hydration failures to its error handler", async () => {
		const error = new Error("private filesystem failure");
		const listener = vi.fn();
		const onError = vi.fn();
		existsAppDataFileMock.mockRejectedValueOnce(error);

		const unsubscribe = subscribeCacheUsage(listener, onError);

		await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
		expect(listener).not.toHaveBeenCalled();
		unsubscribe();
	});
});

describe("cache manifest write amplification", () => {
	it("does not rewrite a clean manifest while listing cache entries", async () => {
		installProfileManifest(1_000);

		await expect(
			listCacheEntries(7001, "profile", (value) => value),
		).resolves.toEqual([{ value: "profile-42" }]);
		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
	});

	it("does not rewrite the manifest for a recently touched cache hit", async () => {
		installProfileManifest(2_000);
		const now = vi.spyOn(Date, "now").mockReturnValue(2_000);

		await expect(
			readCacheEntry(7001, "profile", "42", (value) => value),
		).resolves.toEqual({ value: "profile-42" });
		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
		now.mockRestore();
	});

	it("persists one coarse LRU touch instead of every repeated hit", async () => {
		installProfileManifest(1_000);
		const now = vi.spyOn(Date, "now").mockReturnValue(3_601_000);

		await readCacheEntry(7001, "profile", "42", (value) => value);
		await readCacheEntry(7001, "profile", "42", (value) => value);

		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
		now.mockRestore();
	});

	it("keeps valid cache data when only the access-time touch fails", async () => {
		installProfileManifest(1_000);
		const now = vi.spyOn(Date, "now").mockReturnValue(3_601_000);
		const touchFailure = new Error("manifest touch unavailable");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		writeAppDataFileAtomicMock.mockRejectedValueOnce(touchFailure);

		await expect(
			readCacheEntry(7001, "profile", "42", (value) => value),
		).resolves.toEqual({ value: "profile-42" });
		expect(removeAppDataFileMock).not.toHaveBeenCalled();
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledWith(
			"Cache manifest access-time update failed",
			touchFailure,
		);

		error.mockRestore();
		now.mockRestore();
	});
});
