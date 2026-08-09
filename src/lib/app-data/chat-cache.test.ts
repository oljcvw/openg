import { describe, expect, it } from "vitest";

import {
	mergeConfirmedMessages,
	migratePersistedConversationToV2,
	pruneConfirmedMessages,
} from "$lib/app-data/chat-cache";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

function message(messageId: string, timestamp: number): ApiResponseMessage {
	return {
		type: "Text",
		body: { text: messageId },
		messageId,
		conversationId: "conversation",
		senderId: 1,
		timestamp,
		unsent: false,
		reactions: [],
	};
}

describe("chat cache retention", () => {
	it("migrates a beta-4 failed reply without inventing confirmation", () => {
		const original = message("original", 1);
		const reply = {
			...message("reply", 2),
			replyToMessage: original,
		};
		const migrated = migratePersistedConversationToV2({
			version: 1,
			messages: [original],
			failedMessages: [
				{
					localId: "local-reply",
					message: reply,
					state: "failed",
					lastAttemptAt: 2,
				},
			],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: 1,
				showDistance: false,
			},
			pageKey: null,
			lastReadTimestamp: null,
			updatedAt: 2,
		});

		expect(migrated.version).toBe(2);
		expect(migrated.failedMessages[0]).toMatchObject({
			localId: "local-reply",
			state: "failed",
			retryCount: 0,
			message: { replyToMessage: { messageId: "original" } },
		});
		expect(migrated.failedMessages[0]).not.toHaveProperty("attemptRef");
		expect(migrated.failedMessages[0]).not.toHaveProperty("outerCommandRef");
	});

	it("keeps only confirmed messages from the last 30 days", () => {
		const now = 40 * 24 * 60 * 60 * 1000;
		expect(
			pruneConfirmedMessages(
				[
					message("old", now - 31 * 24 * 60 * 60 * 1000),
					message("recent", now - 30 * 24 * 60 * 60 * 1000),
				],
				now,
			).map(({ messageId }) => messageId),
		).toEqual(["recent"]);
	});

	it("keeps the newest 500 confirmed messages", () => {
		const messages = Array.from({ length: 550 }, (_, index) =>
			message(String(index), index + 1),
		);
		const retained = pruneConfirmedMessages(messages, 550);
		expect(retained).toHaveLength(500);
		expect(retained[0].messageId).toBe("549");
		expect(retained.at(-1)?.messageId).toBe("50");
	});

	it("merges an evicted active window without dropping durable history", () => {
		const merged = mergeConfirmedMessages(
			[message("evicted", 1), message("active", 2)],
			[message("active", 3), message("new", 4)],
			new Set(["deleted"]),
		);

		expect(merged.map(({ messageId }) => messageId)).toEqual([
			"new",
			"active",
			"evicted",
		]);
		expect(
			merged.find(({ messageId }) => messageId === "active")?.timestamp,
		).toBe(3);
	});
});
