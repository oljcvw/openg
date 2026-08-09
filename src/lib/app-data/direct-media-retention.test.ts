import { describe, expect, it, vi } from "vitest";

const { importLegacyMock, setScopeMock, storeMock, upsertMock } = vi.hoisted(
	() => ({
		importLegacyMock: vi.fn(),
		setScopeMock: vi.fn().mockResolvedValue(undefined),
		storeMock: vi.fn(),
		upsertMock: vi.fn().mockResolvedValue(undefined),
	}),
);

vi.mock("$lib/app-data/direct-media-cache", () => ({
	importLegacyDirectMedia: importLegacyMock,
	setDirectMediaCacheScope: setScopeMock,
	storeDirectMedia: storeMock,
	upsertDirectMediaHistory: upsertMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({
		directMediaCacheConcurrency: 2,
		directMediaCacheMb: 30,
	}),
	getRetainSharedChatMediaSnapshot: () => true,
}));
vi.mock("$lib/api/account-caches", () => ({ registerAccountCache: vi.fn() }));

import {
	importLegacyRetainedDirectMedia,
	queueVisibleDirectMedia,
	retainAuthorizedDirectMedia,
	setDirectMediaRetentionScope,
} from "$lib/app-data/direct-media-retention";
import type { SharedMediaEntry } from "$lib/chat/shared-media";

describe("direct-media conversation scope fencing", () => {
	it("discards a completed conversation-A store after switching to B", async () => {
		let finishStore!: (value: unknown) => void;
		storeMock.mockReturnValueOnce(
			new Promise((resolve) => (finishStore = resolve)),
		);
		setDirectMediaRetentionScope({
			accountProfileId: 1,
			conversationId: "A",
			peerProfileId: 2,
		});
		const entry: SharedMediaEntry = {
			accountProfileId: 1,
			conversationId: "A",
			peerProfileId: 2,
			messageId: "message",
			mediaId: "media",
			kind: "image",
			messageType: "Image",
			sentAt: 1,
			remoteAvailability: "available",
			cacheAvailability: "not_cached",
			cacheToken: null,
			consumptive: false,
			remoteUrl: "https://cdns.grindr.com/media",
		};
		const queued = queueVisibleDirectMedia(entry);
		await vi.waitFor(() => expect(storeMock).toHaveBeenCalledOnce());
		const tokenA = storeMock.mock.calls[0]?.[0].scopeToken;

		setDirectMediaRetentionScope({
			accountProfileId: 1,
			conversationId: "B",
			peerProfileId: 3,
		});
		const tokenB = setScopeMock.mock.calls.at(-1)?.[1];
		expect(tokenB).not.toBe(tokenA);
		finishStore({ protocolUrl: "direct-media-cache://localhost/opaque" });
		await expect(queued).resolves.toBeNull();
	});

	it("does not retain media authorized for a conversation that is no longer active", async () => {
		storeMock.mockClear();
		setDirectMediaRetentionScope({
			accountProfileId: 1,
			conversationId: "A",
			peerProfileId: 2,
		});
		setDirectMediaRetentionScope({
			accountProfileId: 1,
			conversationId: "B",
			peerProfileId: 3,
		});
		const staleEntry: SharedMediaEntry = {
			accountProfileId: 1,
			conversationId: "A",
			peerProfileId: 2,
			messageId: "message",
			mediaId: "media",
			kind: "image",
			messageType: "ExpiringImage",
			sentAt: 1,
			remoteAvailability: "available",
			cacheAvailability: "not_cached",
			cacheToken: null,
			consumptive: true,
			remoteUrl: "https://cdns.grindr.com/media",
		};

		await expect(
			retainAuthorizedDirectMedia(staleEntry, "image/jpeg"),
		).resolves.toBeNull();
		expect(storeMock).not.toHaveBeenCalled();
	});

	it("discards beta-4 bytes when their validated conversation scope is stale", async () => {
		importLegacyMock.mockClear();
		setDirectMediaRetentionScope({
			accountProfileId: 1,
			conversationId: "B",
			peerProfileId: 3,
		});

		await expect(
			importLegacyRetainedDirectMedia(
				{
					accountProfileId: 1,
					conversationId: "A",
					peerProfileId: 2,
					messageId: "message",
					mediaId: "media",
					kind: "video",
					messageType: "PrivateVideo",
					sentAt: 1,
					remoteAvailability: "views_exhausted",
					cacheAvailability: "cached",
					cacheToken: null,
					consumptive: true,
					remoteUrl: null,
				},
				"video/mp4",
				"AQID",
				3,
			),
		).resolves.toBeNull();
		expect(importLegacyMock).not.toHaveBeenCalled();
	});
});
