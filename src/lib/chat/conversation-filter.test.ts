import { describe, expect, it } from "vitest";

import { filterConversations } from "$lib/chat/conversation-filter";
import type { Conversation } from "$lib/model/messaging/conversations";

function conversation(
	name: string,
	{
		favorite = false,
		unreadCount = 0,
	}: { favorite?: boolean; unreadCount?: number } = {},
): Conversation {
	return {
		type: "full_conversation_v1",
		data: {
			conversationId: name,
			name,
			participants: [
				{
					profileId: 1,
					primaryMediaHash: null,
					lastOnline: null,
					onlineUntil: null,
					distanceMetres: null,
					position: null,
					isInAList: false,
					hasDatingPotential: false,
				},
			],
			lastActivityTimestamp: 0,
			unreadCount,
			preview: null,
			muted: false,
			pinned: false,
			favorite,
			rightNow: "NOT_ACTIVE",
			onlineUntil: null,
			hasUnreadThrob: false,
		},
	};
}

const conversations = [
	conversation("Alex", { favorite: true }),
	conversation("Ben", { unreadCount: 2 }),
	conversation("Cal"),
];

describe("conversation filters", () => {
	it("searches loaded conversations by display name without case sensitivity", () => {
		expect(
			filterConversations(conversations, { filter: "all", query: "  ALEX " }),
		).toEqual([conversations[0]]);
	});

	it("filters favorite and unread conversations from authoritative row state", () => {
		expect(
			filterConversations(conversations, { filter: "favorites", query: "" }),
		).toEqual([conversations[0]]);
		expect(
			filterConversations(conversations, { filter: "unread", query: "" }),
		).toEqual([conversations[1]]);
	});

	it("combines a state filter with display-name search", () => {
		expect(
			filterConversations(conversations, {
				filter: "favorites",
				query: "Ben",
			}),
		).toEqual([]);
	});
});
