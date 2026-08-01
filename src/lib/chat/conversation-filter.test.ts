import { describe, expect, it } from "vitest";

import {
	filterConversations,
	messageCorpusMatchesQuery,
} from "$lib/chat/conversation-filter";
import type { Conversation } from "$lib/model/messaging/conversations";

function conversation(
	name: string,
	{
		favorite = false,
		previewText = null,
		unreadCount = 0,
	}: {
		favorite?: boolean;
		previewText?: string | null;
		unreadCount?: number;
	} = {},
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
			preview:
				previewText === null
					? null
					: {
							type: "Text",
							text: previewText,
							albumId: null,
							imageHash: null,
						},
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

	it("matches preview text and complete-history message matches", () => {
		const withPreview = conversation("Dee", {
			previewText: "Meet after work?",
		});
		const withHistoryMatch = conversation("Eli");
		const rows = [withPreview, withHistoryMatch];

		expect(
			filterConversations(rows, { filter: "all", query: "AFTER WORK" }),
		).toEqual([withPreview]);
		expect(
			filterConversations(rows, {
				filter: "all",
				messageMatchIds: [withHistoryMatch.data.conversationId],
				query: "older message",
			}),
		).toEqual([withHistoryMatch]);
	});

	it("still applies unread and favorite filters to message-body matches", () => {
		const unread = conversation("Fox", { unreadCount: 1 });
		const read = conversation("Gus");

		expect(
			filterConversations([unread, read], {
				filter: "unread",
				messageMatchIds: [unread.data.conversationId, read.data.conversationId],
				query: "message text",
			}),
		).toEqual([unread]);
	});
});

describe("retracted message search", () => {
	it("hides retracted text by default and restores it when opted in", () => {
		const texts = new Map([
			["ordinary", "ordinary text"],
			["retracted", "private needle"],
		]);
		const retracted = new Set(["retracted"]);

		expect(messageCorpusMatchesQuery(texts, retracted, "needle", false)).toBe(
			false,
		);
		expect(messageCorpusMatchesQuery(texts, retracted, "needle", true)).toBe(
			true,
		);
	});
});
