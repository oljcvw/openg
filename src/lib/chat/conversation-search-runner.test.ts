import { describe, expect, it, vi } from "vitest";

import { compileConversationSearch } from "$lib/chat/conversation-search";
import type { ConversationSearchIndex } from "$lib/chat/conversation-search-index";
import type { Conversation } from "$lib/model/messaging/conversations";
import { runConversationSearch } from "./conversation-search-runner";

function conversation(id: string, revision = 1): Conversation {
	return {
		data: {
			conversationId: id,
			name: id,
			preview: null,
			lastActivityTimestamp: revision,
		},
	} as Conversation;
}

function fakeIndex(
	ensureMatch: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(false),
): ConversationSearchIndex {
	return { ensureMatch } as unknown as ConversationSearchIndex;
}

describe("runConversationSearch", () => {
	it("loads every conversation page before searching histories", async () => {
		const entries = [conversation("a")];
		let nextPage: number | null = 2;
		const ensureMatch = vi.fn().mockResolvedValue(false);
		const progress = vi.fn();

		await runConversationSearch({
			index: fakeIndex(ensureMatch),
			query: compileConversationSearch("needle"),
			getConversations: () => entries,
			hasMoreConversations: () => nextPage !== null,
			conversationPageToken: () => String(nextPage),
			loadMoreConversations: () => {
				entries.push(conversation("b"));
				nextPage = null;
				return Promise.resolve();
			},
			getPagingFailure: () => null,
			prime: vi.fn(),
			isCurrent: () => true,
			onProgress: progress,
		});

		expect(ensureMatch).toHaveBeenCalledTimes(2);
		expect(
			ensureMatch.mock.calls.map(
				([args]) => args.conversation.data.conversationId,
			),
		).toEqual(expect.arrayContaining(["a", "b"]));
		expect(progress).toHaveBeenCalledTimes(2);
	});

	it("rejects a pagination cursor that does not advance", async () => {
		await expect(
			runConversationSearch({
				index: fakeIndex(),
				query: compileConversationSearch("needle"),
				getConversations: () => [],
				hasMoreConversations: () => true,
				conversationPageToken: () => "2:0",
				loadMoreConversations: () => Promise.resolve(),
				getPagingFailure: () => null,
				prime: vi.fn(),
				isCurrent: () => true,
				onProgress: vi.fn(),
			}),
		).rejects.toThrow("did not advance");
	});

	it("stops scheduling work when the query becomes stale", async () => {
		let current = true;
		let nextPage: number | null = 2;
		const ensureMatch = vi.fn().mockResolvedValue(false);

		await runConversationSearch({
			index: fakeIndex(ensureMatch),
			query: compileConversationSearch("needle"),
			getConversations: () => [conversation("a")],
			hasMoreConversations: () => nextPage !== null,
			conversationPageToken: () => String(nextPage),
			loadMoreConversations: () => {
				nextPage = null;
				current = false;
				return Promise.resolve();
			},
			getPagingFailure: () => null,
			prime: vi.fn(),
			isCurrent: () => current,
			onProgress: vi.fn(),
		});

		expect(ensureMatch).not.toHaveBeenCalled();
	});

	it("rechecks a conversation that changes during the scan", async () => {
		const entries = [conversation("a", 1)];
		const ensureMatch = vi.fn().mockImplementation(() => {
			if (ensureMatch.mock.calls.length === 1)
				entries[0] = conversation("a", 2);
			return Promise.resolve(false);
		});

		await runConversationSearch({
			index: fakeIndex(ensureMatch),
			query: compileConversationSearch("needle"),
			getConversations: () => entries,
			hasMoreConversations: () => false,
			conversationPageToken: () => "null",
			loadMoreConversations: () => Promise.resolve(),
			getPagingFailure: () => null,
			prime: vi.fn(),
			isCurrent: () => true,
			onProgress: vi.fn(),
		});

		expect(ensureMatch).toHaveBeenCalledTimes(2);
	});
});
