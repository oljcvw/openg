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
	importLegacyDirectMedia,
	listDirectMediaHistory,
	setDirectMediaCacheScope,
	storeDirectMedia,
	trimDirectMediaCache,
	upsertDirectMediaHistory,
} from "$lib/app-data/direct-media-cache";

const identity = {
	accountProfileId: 1,
	conversationId: "conversation",
	peerProfileId: 2,
	messageId: "message",
	mediaId: "media",
};

describe("direct-media cache bridge", () => {
	beforeEach(() => invokeMock.mockReset());

	it("binds store to complete validated message identity", async () => {
		invokeMock.mockResolvedValue({
			token: "opaque",
			protocolUrl: "direct-media-cache://localhost/opaque",
			byteLength: 12,
			contentType: "image/webp",
		});
		await storeDirectMedia({
			...identity,
			kind: "image",
			messageType: "Image",
			sentAt: 3,
			remoteAvailability: "available",
			sourceUrl: "https://cdns.grindr.com/media",
			contentType: "image/jpeg",
			maximumBytes: 100,
			scopeToken: "scope-a",
		});
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_store", {
			accountId: "1",
			conversationId: "conversation",
			peerProfileId: "2",
			messageId: "message",
			mediaId: "media",
			kind: "image",
			messageType: "Image",
			sentAt: 3,
			remoteAvailability: "available",
			sourceUrl: "https://cdns.grindr.com/media",
			contentType: "image/jpeg",
			maximumBytes: 100,
			scopeToken: "scope-a",
		});
	});

	it("imports validated beta-4 bytes without a remote URL", async () => {
		invokeMock.mockResolvedValue({
			token: "opaque",
			protocolUrl: "direct-media-cache://localhost/opaque",
			byteLength: 3,
			contentType: "video/mp4",
		});
		await importLegacyDirectMedia({
			...identity,
			kind: "video",
			messageType: "PrivateVideo",
			sentAt: 3,
			remoteAvailability: "views_exhausted",
			dataBase64: "AQID",
			contentType: "video/mp4",
			maximumBytes: 100,
			scopeToken: "scope-a",
		});
		expect(invokeMock).toHaveBeenCalledWith(
			"direct_media_cache_import_legacy",
			expect.objectContaining({
				accountId: "1",
				conversationId: "conversation",
				peerProfileId: "2",
				messageId: "message",
				mediaId: "media",
				dataBase64: "AQID",
				scopeToken: "scope-a",
			}),
		);
	});

	it("sets an opaque native scope used to fence conversation downloads", async () => {
		invokeMock.mockResolvedValue(undefined);
		await setDirectMediaCacheScope(1, "scope-b", "conversation", 2);
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_set_scope", {
			accountId: "1",
			scopeToken: "scope-b",
			conversationId: "conversation",
			peerProfileId: "2",
		});
	});

	it("forwards the total byte limit to native LRU trimming", async () => {
		invokeMock.mockResolvedValue({
			byteLength: 10,
			cachedCount: 1,
			historyCount: 2,
			accountCount: 1,
			cacheEpoch: 0,
		});

		await trimDirectMediaCache(30 * 1024 * 1024);
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_trim", {
			maximumBytes: 30 * 1024 * 1024,
		});
	});

	it("upserts availability without downloading media", async () => {
		invokeMock.mockResolvedValue(undefined);
		await upsertDirectMediaHistory({
			...identity,
			kind: "video",
			messageType: "PrivateVideo",
			sentAt: 3,
			remoteAvailability: "retracted",
		});
		expect(invokeMock).toHaveBeenCalledOnce();
		expect(invokeMock.mock.calls[0]?.[0]).toBe("direct_media_cache_upsert");
		expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("sourceUrl");
	});

	it("lists one opaque cursor page without blob payloads or URLs", async () => {
		invokeMock.mockResolvedValue({
			items: [
				{
					...identity,
					accountId: "1",
					peerProfileId: "2",
					kind: "image",
					messageType: "Image",
					sentAt: 3,
					remoteAvailability: "available",
					cacheAvailability: "cached",
					cacheToken: "opaque",
					contentType: "image/jpeg",
					byteLength: 12,
					fileName: "opaque.ogdm",
					lastAccessedMs: 4,
				},
			],
			nextCursor: "cursor",
			totalCount: 1,
		});
		const page = await listDirectMediaHistory({
			accountProfileId: 1,
			conversationId: "conversation",
			peerProfileId: 2,
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]).not.toHaveProperty("sourceUrl");
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_list", {
			accountId: "1",
			conversationId: "conversation",
			peerProfileId: "2",
			cursor: null,
			pageSize: 60,
		});
	});
});
