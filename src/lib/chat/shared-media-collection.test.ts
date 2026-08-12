import { describe, expect, it, vi } from "vitest";

import {
	conversationMediaDeckItems,
	mergeSharedMediaSources,
	SharedMediaCollection,
} from "$lib/chat/shared-media-collection";
import { apiResponseMessageSchema } from "$lib/model/messaging/messages";
import type { SharedMediaEntry } from "$lib/chat/shared-media";

const context = {
	accountProfileId: 7,
	conversationId: "conversation-42",
	peerProfileId: 42,
};

function message(messageId: string, timestamp: number, overrides = {}) {
	return apiResponseMessageSchema.parse({
		type: "Image",
		body: {
			mediaId: Number(messageId.replace(/\D/g, "")) || 1,
			url: `https://images.example/${messageId}.jpg`,
			width: 10,
			height: 10,
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: null,
		},
		messageId,
		conversationId: context.conversationId,
		senderId: context.peerProfileId,
		timestamp,
		unsent: false,
		reactions: [],
		...overrides,
	});
}

function retained(messageId: string, sentAt: number): SharedMediaEntry {
	return {
		...context,
		messageId,
		mediaId: messageId,
		kind: "image",
		messageType: "Image",
		sentAt,
		remoteAvailability: "available",
		cacheAvailability: "cached",
		cacheToken: `token-${messageId}`,
		consumptive: false,
		remoteUrl: null,
	};
}

describe("received shared-media collection", () => {
	it("prefers active/server records by message ID but retains distinct share events", () => {
		const entries = mergeSharedMediaSources({
			context,
			active: [message("message-1", 100)],
			cached: [message("message-1", 90), message("message-2", 80)],
			retained: [retained("message-1", 70), retained("message-3", 60)],
		});

		expect(entries.map((entry) => entry.messageId)).toEqual([
			"message-1",
			"message-2",
			"message-3",
		]);
		expect(entries[0]!.remoteUrl).toContain("message-1.jpg");
		expect(entries[0]!.cacheAvailability).toBe("cached");
	});

	it("keeps a retracted share only when encrypted bytes remain", () => {
		const cached = retained("message-1", 100);
		const uncached = {
			...retained("message-2", 90),
			cacheAvailability: "not_cached" as const,
			cacheToken: null,
		};
		const entries = mergeSharedMediaSources({
			context,
			active: [
				message("message-1", 100, { unsent: true }),
				message("message-2", 90, { unsent: true }),
			],
			cached: [],
			retained: [cached, uncached],
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]!).toMatchObject({
			messageId: "message-1",
			remoteAvailability: "retracted",
			cacheAvailability: "cached",
			remoteUrl: null,
		});
	});

	it("paginates without losing partial results and stops repeated cursors", async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				messages: [message("message-4", 40)],
				nextPageKey: "page-2",
			})
			.mockResolvedValueOnce({
				messages: [message("message-5", 30)],
				nextPageKey: "page-2",
			});
		const collection = new SharedMediaCollection({
			context,
			active: [message("message-1", 100)],
			cached: [],
			retained: [],
			initialPageKey: "page-1",
			fetchPage,
		});

		await collection.loadOlder();
		await collection.loadOlder();
		await collection.loadOlder();
		expect(fetchPage).toHaveBeenCalledTimes(2);
		expect(collection.entries.map((entry) => entry.messageId)).toEqual([
			"message-1",
			"message-4",
			"message-5",
		]);
		expect(collection.nextPageKey).toBeNull();
	});

	it("preserves validated results after a later page fails", async () => {
		const collection = new SharedMediaCollection({
			context,
			active: [message("message-1", 100)],
			cached: [],
			retained: [],
			initialPageKey: "page-1",
			fetchPage: vi.fn().mockRejectedValue(new Error("offline")),
		});

		await collection.loadOlder();
		expect(collection.entries.map((entry) => entry.messageId)).toEqual([
			"message-1",
		]);
		expect(collection.error).toBeInstanceOf(Error);
		expect(collection.nextPageKey).toBe("page-1");
	});

	it("keeps stable bounded pages for at least 1,000 durable records", () => {
		const history = Array.from({ length: 1_000 }, (_, index) =>
			retained(`message-${index.toString().padStart(4, "0")}`, index),
		).toSorted(
			(left, right) =>
				right.sentAt - left.sentAt ||
				right.messageId.localeCompare(left.messageId),
		);
		const collection = new SharedMediaCollection({
			context,
			active: [],
			cached: [],
			retained: history,
			initialPageKey: null,
			fetchPage: vi.fn(),
		});

		expect(collection.historyPage(0).entries).toHaveLength(60);
		expect(collection.historyPage(16).entries).toHaveLength(40);
		expect(collection.historyPage(17).entries).toHaveLength(0);
		expect(collection.historyPage(0).entries[0]!.messageId).toBe(
			"message-0999",
		);
	});

	it("builds the viewer deck oldest-to-newest and excludes uncached limited media", () => {
		const limited = {
			...message("message-2", 200),
			type: "ExpiringImage" as const,
			body: {
				mediaId: 2,
				url: "https://images.example/limited.jpg",
				width: 20,
				height: 10,
				viewsRemaining: 1,
			},
		};
		const items = conversationMediaDeckItems({
			context,
			active: [message("message-3", 300), limited, message("message-1", 100)],
			cached: [],
			retained: [],
			resolvedUrls: {},
		});

		expect(items.map((item) => item.id)).toEqual(["message-1", "message-3"]);
		expect(items[0]!).toMatchObject({ width: 10, height: 10 });

		const retainedLimited = conversationMediaDeckItems({
			context,
			active: [limited],
			cached: [],
			retained: [],
			resolvedUrls: { "message-2": "direct-media://retained" },
		});
		expect(retainedLimited).toMatchObject([
			{ id: "message-2", url: "direct-media://retained" },
		]);
	});
});
