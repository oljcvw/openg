import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock, getSessionMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	isTauriMock: vi.fn(() => true),
	getSessionMock: vi.fn(() => ({ accountId: 42, generation: 1 })),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
	isTauri: isTauriMock,
}));
vi.mock("$lib/api/account-caches", () => ({
	getAccountSessionSnapshot: getSessionMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({ directMediaCacheMb: 30 }),
}));

import {
	cacheShortVideo,
	clearShortVideoCache,
	getCachedShortVideo,
	removeCachedShortVideo,
	trimShortVideoCache,
} from "$lib/app-data/short-video-cache";

describe("short-video cache bridge", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		isTauriMock.mockReturnValue(true);
		getSessionMock.mockReturnValue({ accountId: 42, generation: 1 });
	});

	it("does not read or delete a different account's colliding media ID", async () => {
		await expect(getCachedShortVideo(9, 7)).resolves.toEqual({ found: false });
		await expect(removeCachedShortVideo(9, 7)).resolves.toBe(false);
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("stores encrypted-cache input with account and bounded limit", async () => {
		invokeMock.mockResolvedValue({ byteLength: 123, entryCount: 1 });

		await expect(cacheShortVideo(9, "bXA0")).resolves.toEqual({
			byteLength: 123,
			entryCount: 1,
		});
		expect(invokeMock).toHaveBeenCalledWith("short_video_cache_put", {
			accountId: "42",
			mediaId: "9",
			dataBase64: "bXA0",
			maximumBytes: 30 * 1024 * 1024,
		});
	});

	it("reads a cached video through its account-scoped media key", async () => {
		invokeMock.mockResolvedValue({
			found: true,
			dataBase64: "bXA0",
			contentType: "video/mp4",
			byteLength: 3,
		});

		await expect(getCachedShortVideo(9)).resolves.toMatchObject({
			found: true,
			dataBase64: "bXA0",
		});
		expect(invokeMock).toHaveBeenCalledWith("short_video_cache_get", {
			accountId: "42",
			mediaId: "9",
		});
	});

	it("clears all accounts only when no account is supplied", async () => {
		invokeMock.mockResolvedValue({ byteLength: 0, entryCount: 0 });

		await clearShortVideoCache();
		await clearShortVideoCache(42);

		expect(invokeMock).toHaveBeenNthCalledWith(1, "short_video_cache_clear", {
			accountId: undefined,
		});
		expect(invokeMock).toHaveBeenNthCalledWith(2, "short_video_cache_clear", {
			accountId: "42",
		});
	});

	it("applies the current developer cache limit", async () => {
		invokeMock.mockResolvedValue({ byteLength: 0, entryCount: 0 });

		await trimShortVideoCache();

		expect(invokeMock).toHaveBeenCalledWith("short_video_cache_trim", {
			maximumBytes: 30 * 1024 * 1024,
		});
	});
});
