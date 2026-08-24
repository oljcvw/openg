import { describe, expect, it, vi } from "vitest";

import { compileConversationSearch } from "$lib/chat/conversation-search";
import type { CachedConversation } from "$lib/chat/cached-conversation";
import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";
import {
	type ConversationHistoryLoader,
	ConversationSearchIndex,
} from "./conversation-search-index";

function conversation(
	id: string,
	{ name = "Alex", revision = 1 }: { name?: string; revision?: number } = {},
): Conversation {
	return {
		data: {
			conversationId: id,
			name,
			preview: null,
			lastActivityTimestamp: revision,
		},
	} as Conversation;
}

function message(id: string, text: string): ApiResponseMessage {
	return {
		messageId: id,
		type: "Text",
		body: { text },
	} as ApiResponseMessage;
}

function cached({
	messages,
	pageKey,
}: {
	messages: ApiResponseMessage[];
	pageKey: string | null;
}): CachedConversation {
	return {
		messages,
		pageKey,
		lastReadTimestamp: null,
		profile: {
			distance: null,
			mediaHash: null,
			name: null,
			onlineUntil: null,
			profileId: 1,
			showDistance: false,
		},
	};
}

describe("ConversationSearchIndex", () => {
	it("does not fetch history when the conversation metadata matches", async () => {
		const loader = vi.fn<ConversationHistoryLoader>();
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a", { name: "Henry" });
		const query = compileConversationSearch("henry");

		await expect(
			index.ensureMatch({ conversation: target, query }),
		).resolves.toBe(true);
		expect(index.getCachedMatch(target, query)).toEqual({
			source: "metadata",
		});
		expect(loader).not.toHaveBeenCalled();
	});

	it("finds a deep-history match and reuses every fetched page", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValueOnce({
				messages: [message("m1", "recent words")],
				nextPageKey: "m1",
			})
			.mockResolvedValueOnce({
				messages: [message("m2", "archived nebula")],
				nextPageKey: "m2",
			})
			.mockResolvedValueOnce({ messages: [], nextPageKey: null });
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a");

		const deepQuery = compileConversationSearch("archived nebula");
		await expect(
			index.ensureMatch({ conversation: target, query: deepQuery }),
		).resolves.toBe(true);
		expect(index.getCachedMatch(target, deepQuery)).toEqual({
			source: "message",
			messageId: "m2",
			preview: "archived nebula",
		});
		expect(loader).toHaveBeenCalledTimes(2);

		await expect(
			index.ensureMatch({
				conversation: target,
				query: compileConversationSearch("recent words"),
			}),
		).resolves.toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);

		await expect(
			index.ensureMatch({
				conversation: target,
				query: compileConversationSearch("missing"),
			}),
		).resolves.toBe(false);
		expect(loader).toHaveBeenCalledTimes(3);
	});

	it("does not invent one target from terms in different messages", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValueOnce({
				messages: [
					message("m1", "only alpha"),
					message("m2", "only beta"),
				],
				nextPageKey: null,
			});
		const index = new ConversationSearchIndex(loader);

		await expect(
			index.ensureMatch({
				conversation: conversation("a"),
				query: compileConversationSearch("alpha beta"),
			}),
		).resolves.toBe(false);
	});

	it("combines metadata terms with one target message", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValueOnce({
				messages: [message("m1", "archived nebula")],
				nextPageKey: null,
			});
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a", { name: "Alex" });
		const query = compileConversationSearch("alex nebula");

		await expect(
			index.ensureMatch({ conversation: target, query }),
		).resolves.toBe(true);
		expect(index.getCachedMatch(target, query)).toEqual({
			source: "message",
			messageId: "m1",
			preview: "archived nebula",
		});
	});

	it("primes the index from already loaded conversation messages", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValue({
				messages: [message("m2", "older text")],
				nextPageKey: "m2",
			});
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a");
		index.prime(
			target,
			cached({ messages: [message("m1", "cached text")], pageKey: "m1" }),
		);

		await expect(
			index.ensureMatch({
				conversation: target,
				query: compileConversationSearch("cached text"),
			}),
		).resolves.toBe(true);
		expect(loader).not.toHaveBeenCalled();
	});

	it("stops a stale query after its current page and resumes from cache", async () => {
		let current = true;
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockImplementationOnce(() => {
				current = false;
				return Promise.resolve({
					messages: [message("m1", "first page")],
					nextPageKey: "m1",
				});
			})
			.mockResolvedValueOnce({
				messages: [message("m2", "second page target")],
				nextPageKey: "m2",
			});
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a");

		await index.ensureMatch({
			conversation: target,
			query: compileConversationSearch("target"),
			isCurrent: () => current,
		});
		expect(loader).toHaveBeenCalledTimes(1);

		current = true;
		await expect(
			index.ensureMatch({
				conversation: target,
				query: compileConversationSearch("target"),
				isCurrent: () => current,
			}),
		).resolves.toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("retains its cursor after a failure so retry can continue", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({
				messages: [message("m1", "recovered target")],
				nextPageKey: "m1",
			});
		const index = new ConversationSearchIndex(loader);
		const args = {
			conversation: conversation("a"),
			query: compileConversationSearch("target"),
		};

		await expect(index.ensureMatch(args)).rejects.toThrow("offline");
		await expect(index.ensureMatch(args)).resolves.toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("caps message requests across conversations", async () => {
		let active = 0;
		let maximum = 0;
		const loader: ConversationHistoryLoader = async () => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return { messages: [], nextPageKey: null };
		};
		const index = new ConversationSearchIndex(loader, { concurrency: 2 });

		await Promise.all(
			["a", "b", "c", "d"].map((id) =>
				index.ensureMatch({
					conversation: conversation(id),
					query: compileConversationSearch("missing"),
				}),
			),
		);
		expect(maximum).toBe(2);
	});

	it("preserves indexed history when conversation metadata changes", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValue({
				messages: [message("m1", "old target")],
				nextPageKey: "m1",
			});
		const index = new ConversationSearchIndex(loader);
		const first = conversation("a", { revision: 1 });
		await index.ensureMatch({
			conversation: first,
			query: compileConversationSearch("old target"),
		});
		const mixedQuery = compileConversationSearch("alex old target");
		expect(index.matchesCached(first, mixedQuery)).toBe(true);

		const changed = conversation("a", { name: "Blake", revision: 2 });
		expect(index.matchesCached(changed, mixedQuery)).toBe(false);
		await expect(
			index.ensureMatch({
				conversation: changed,
				query: compileConversationSearch("old target"),
			}),
		).resolves.toBe(true);
		expect(loader).toHaveBeenCalledOnce();
	});

	it("adds new messages without discarding indexed history", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValue({
				messages: [message("m1", "archived target")],
				nextPageKey: "m1",
			});
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a", { revision: 1 });
		await index.ensureMatch({
			conversation: target,
			query: compileConversationSearch("archived target"),
		});

		index.appendMessage(target, message("m2", "fresh arrival"));
		const changed = conversation("a", { revision: 2 });
		await expect(
			index.ensureMatch({
				conversation: changed,
				query: compileConversationSearch("fresh arrival"),
			}),
		).resolves.toBe(true);
		await expect(
			index.ensureMatch({
				conversation: changed,
				query: compileConversationSearch("archived target"),
			}),
		).resolves.toBe(true);
		expect(loader).toHaveBeenCalledOnce();
	});

	it("drops indexed history only when explicitly invalidated", async () => {
		const loader = vi
			.fn<ConversationHistoryLoader>()
			.mockResolvedValueOnce({
				messages: [message("m1", "removed target")],
				nextPageKey: "m1",
			})
			.mockResolvedValueOnce({ messages: [], nextPageKey: null });
		const index = new ConversationSearchIndex(loader);
		const target = conversation("a");
		await index.ensureMatch({
			conversation: target,
			query: compileConversationSearch("removed target"),
		});

		index.invalidate("a");
		await expect(
			index.ensureMatch({
				conversation: target,
				query: compileConversationSearch("removed target"),
			}),
		).resolves.toBe(false);
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
