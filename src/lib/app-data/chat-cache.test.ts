import { describe, expect, it } from "vitest";

import { pruneConfirmedMessages } from "$lib/app-data/chat-cache";
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
});
