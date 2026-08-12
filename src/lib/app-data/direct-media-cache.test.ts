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
	clearDirectMediaCache,
	importLegacyDirectMedia,
	listDirectMediaHistory,
	resetDirectMediaHistoryFingerprints,
	setDirectMediaCacheScope,
	storeDirectMedia,
	trimDirectMediaCache,
	upsertDirectMediaHistory,
	upsertDirectMediaHistoryBatch,
} from "$lib/app-data/direct-media-cache";

const identity = {
	accountProfileId: 1,
	conversationId: "conversation",
	peerProfileId: 2,
	messageId: "message",
	mediaId: "media",
};

describe("direct-media cache bridge", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		resetDirectMediaHistoryFingerprints();
	});

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
		expect(invokeMock.mock.calls[0]?.[0]).toBe(
			"direct_media_cache_upsert_batch",
		);
		expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("sourceUrl");
	});

	it("sends one native batch delta for one newly observed media item", async () => {
		invokeMock.mockResolvedValue(undefined);
		await upsertDirectMediaHistoryBatch([
			{
				...identity,
				kind: "image",
				messageType: "Image",
				sentAt: 3,
				remoteAvailability: "available",
			},
		]);
		expect(invokeMock).toHaveBeenCalledOnce();
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_upsert_batch", {
			deltas: [
				expect.objectContaining({
					accountId: "1",
					conversationId: "conversation",
					peerProfileId: "2",
					messageId: "message",
					mediaId: "media",
				}),
			],
		});
	});

	it("suppresses an identical per-conversation fingerprint before native", async () => {
		invokeMock.mockResolvedValue(undefined);
		const delta = {
			...identity,
			kind: "image" as const,
			messageType: "Image" as const,
			sentAt: 3,
			remoteAvailability: "available" as const,
		};
		await upsertDirectMediaHistoryBatch([delta]);
		await upsertDirectMediaHistoryBatch([delta]);
		expect(invokeMock).toHaveBeenCalledOnce();
	});

	it("clear fences old fingerprints so fresh state can repopulate", async () => {
		invokeMock.mockResolvedValue(undefined);
		const delta = {
			...identity,
			kind: "image" as const,
			messageType: "Image" as const,
			sentAt: 3,
			remoteAvailability: "available" as const,
		};
		await upsertDirectMediaHistoryBatch([delta]);
		invokeMock.mockResolvedValueOnce({
			byteLength: 0,
			cachedCount: 0,
			historyCount: 0,
			accountCount: 0,
			cacheEpoch: 1,
		});
		await clearDirectMediaCache(1);
		invokeMock.mockResolvedValue(undefined);
		await upsertDirectMediaHistoryBatch([delta]);
		expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
			"direct_media_cache_upsert_batch",
			"direct_media_cache_clear",
			"direct_media_cache_upsert_batch",
		]);
	});

	it("does not restore a stale fingerprint when upsert completes after clear", async () => {
		let finish!: () => void;
		invokeMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		const delta = {
			...identity,
			kind: "image" as const,
			messageType: "Image" as const,
			sentAt: 3,
			remoteAvailability: "available" as const,
		};
		const pending = upsertDirectMediaHistoryBatch([delta]);
		resetDirectMediaHistoryFingerprints(1);
		finish();
		await pending;
		invokeMock.mockResolvedValue(undefined);
		await upsertDirectMediaHistoryBatch([delta]);
		expect(invokeMock).toHaveBeenCalledTimes(2);
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
					protocolUrl: "direct-media-cache://localhost/opaque",
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
		expect(page.items[0]?.protocolUrl).toBe(
			"direct-media-cache://localhost/opaque",
		);
		expect(invokeMock).toHaveBeenCalledWith("direct_media_cache_list", {
			accountId: "1",
			conversationId: "conversation",
			peerProfileId: "2",
			cursor: null,
			pageSize: 60,
		});
	});
});
