import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	isTauriMock: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
	isTauri: isTauriMock,
}));

import {
	bindLegacyAlbumMediaOwner,
	lookupAlbumMedia,
	pageAlbumRecords,
	storeAlbumMedia,
	storeAlbumRecord,
} from "$lib/app-data/album-media-cache";

describe("album media cache composite identity", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		isTauriMock.mockReturnValue(true);
	});

	it("binds stored media to account owner album and content", async () => {
		invokeMock
			.mockResolvedValueOnce({
				token: "opaque",
				byteLength: 12,
				protocolUrl: "album-cache://localhost/opaque",
			})
			.mockResolvedValueOnce({
				byteLength: 12,
				entryCount: 1,
				albumCount: 1,
				accountCount: 1,
			});
		await storeAlbumMedia({
			accountId: 10,
			ownerProfileId: 11,
			albumId: 12,
			contentId: 13,
			sourceUrl: "https://cdns.grindr.com/media",
			contentType: "image/jpeg",
			maximumBytes: 100,
		});
		expect(invokeMock).toHaveBeenNthCalledWith(1, "album_cache_store", {
			accountId: "10",
			ownerProfileId: "11",
			albumId: "12",
			contentId: "13",
			sourceUrl: "https://cdns.grindr.com/media",
			contentType: "image/jpeg",
			maximumBytes: 100,
		});
	});

	it("binds lookup to the same composite identity", async () => {
		invokeMock.mockResolvedValue({ found: false });
		await lookupAlbumMedia({
			accountId: 10,
			ownerProfileId: 11,
			albumId: 12,
			contentId: 13,
		});
		expect(invokeMock).toHaveBeenCalledWith("album_cache_lookup", {
			accountId: "10",
			ownerProfileId: "11",
			albumId: "12",
			contentId: "13",
		});
	});

	it("binds legacy media only after validated ownership is supplied", async () => {
		invokeMock.mockResolvedValue(3);
		await expect(
			bindLegacyAlbumMediaOwner({
				accountId: 10,
				ownerProfileId: 11,
				albumId: 12,
			}),
		).resolves.toBe(3);
		expect(invokeMock).toHaveBeenCalledWith("album_cache_bind_legacy_owner", {
			accountId: "10",
			ownerProfileId: "11",
			albumId: "12",
		});
	});

	it("stores encrypted metadata and pages history by account and owner", async () => {
		invokeMock
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ records: [], nextCursor: null });
		await storeAlbumRecord({
			accountId: 10,
			ownerProfileId: 11,
			albumId: 12,
			record: { version: 2 },
		});
		await pageAlbumRecords({
			accountId: 10,
			ownerProfileId: 11,
			cursor: "opaque",
		});
		expect(invokeMock).toHaveBeenNthCalledWith(1, "album_cache_record_store", {
			accountId: "10",
			ownerProfileId: "11",
			albumId: "12",
			record: { version: 2 },
		});
		expect(invokeMock).toHaveBeenNthCalledWith(2, "album_cache_records_page", {
			accountId: "10",
			ownerProfileId: "11",
			cursor: "opaque",
		});
	});
});
