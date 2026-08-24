import {
	conversationSearchBaseChunks,
	type ConversationSearchQuery,
	conversationSearchRevision,
	messageSearchTextValues,
	normalizeSearchText,
	searchMatchPreview,
} from "$lib/chat/conversation-search";
import type { CachedConversation } from "$lib/chat/cached-conversation";
import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

export type ConversationHistoryPage = {
	messages: ApiResponseMessage[];
	nextPageKey: string | null;
};

export type ConversationHistoryLoader = (args: {
	conversationId: string;
	pageKey?: string;
}) => Promise<ConversationHistoryPage>;

const MAX_CACHED_QUERIES = 8;

export type ConversationSearchMatch =
	| { source: "metadata" }
	| { source: "message"; messageId: string; preview: string };

type IndexedMessage = {
	messageId: string;
	parts: { text: string; normalized: string }[];
};

type QueryState = {
	baseKey: string;
	historyCursor: number;
	match: Extract<ConversationSearchMatch, { source: "message" }> | null;
};

type IndexEntry = {
	revision: string;
	baseChunks: string[];
	historyMessages: IndexedMessage[];
	messageIds: Set<string>;
	nextPageKey: string | null | undefined;
	inFlight: Promise<void> | null;
	queryStates: Map<string, QueryState>;
};

class RequestLimiter {
	#active = 0;
	#queue: (() => void)[] = [];

	constructor(private readonly concurrency: number) {}

	run<T>(task: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.#queue.push(() => {
				this.#active += 1;
				void task()
					.then(resolve, reject)
					.finally(() => {
						this.#active -= 1;
						this.#pump();
					});
			});
			this.#pump();
		});
	}

	#pump(): void {
		while (this.#active < this.concurrency) {
			const start = this.#queue.shift();
			if (!start) return;
			start();
		}
	}
}

export class ConversationSearchIndex {
	#entries = new Map<string, IndexEntry>();
	#limiter: RequestLimiter;

	constructor(
		private readonly loadPage: ConversationHistoryLoader,
		{ concurrency = 3 }: { concurrency?: number } = {},
	) {
		if (!Number.isInteger(concurrency) || concurrency < 1) {
			throw new Error("Search concurrency must be a positive integer");
		}
		this.#limiter = new RequestLimiter(concurrency);
	}

	prime(
		conversation: Conversation | undefined,
		cached: CachedConversation | undefined,
	): void {
		if (!conversation || !cached) return;
		const entry = this.#entryFor(conversation);
		this.#appendMessages(entry, cached.messages);
		if (entry.nextPageKey === undefined || cached.pageKey === null) {
			entry.nextPageKey = cached.pageKey;
		}
	}

	appendMessage(
		conversation: Conversation | undefined,
		message: ApiResponseMessage,
	): void {
		if (!conversation) return;
		const entry = this.#entries.get(conversation.data.conversationId);
		if (!entry) return;
		this.#refreshMetadata(entry, conversation);
		this.#appendMessages(entry, [message]);
	}

	matchesCached(
		conversation: Conversation,
		query: ConversationSearchQuery,
	): boolean {
		return this.getCachedMatch(conversation, query) !== null;
	}

	getCachedMatch(
		conversation: Conversation,
		query: ConversationSearchQuery,
	): ConversationSearchMatch | null {
		const entry = this.#entryFor(conversation);
		return this.#matchEntry(entry, query);
	}

	async ensureMatch({
		conversation,
		query,
		isCurrent = () => true,
	}: {
		conversation: Conversation;
		query: ConversationSearchQuery;
		isCurrent?: () => boolean;
	}): Promise<boolean> {
		const entry = this.#entryFor(conversation);
		while (isCurrent()) {
			if (this.#matchEntry(entry, query)) return true;
			if (entry.nextPageKey === null) return false;
			await this.#loadNextPage({
				conversationId: conversation.data.conversationId,
				entry,
				isCurrent,
			});
		}
		return this.matchesCached(conversation, query);
	}

	invalidate(conversationId: string): void {
		this.#entries.delete(conversationId);
	}

	delete(conversationId: string): void {
		this.#entries.delete(conversationId);
	}

	clear(): void {
		this.#entries.clear();
	}

	#entryFor(conversation: Conversation): IndexEntry {
		const conversationId = conversation.data.conversationId;
		const current = this.#entries.get(conversationId);
		if (current) {
			this.#refreshMetadata(current, conversation);
			return current;
		}

		const entry: IndexEntry = {
			revision: conversationSearchRevision(conversation),
			baseChunks: conversationSearchBaseChunks(conversation),
			historyMessages: [],
			messageIds: new Set(),
			nextPageKey: undefined,
			inFlight: null,
			queryStates: new Map(),
		};
		this.#entries.set(conversationId, entry);
		return entry;
	}

	#refreshMetadata(entry: IndexEntry, conversation: Conversation): void {
		const revision = conversationSearchRevision(conversation);
		if (entry.revision === revision) return;
		entry.revision = revision;
		entry.baseChunks = conversationSearchBaseChunks(conversation);
	}

	#matchEntry(
		entry: IndexEntry,
		query: ConversationSearchQuery,
	): ConversationSearchMatch | null {
		if (query.terms.length === 0) return { source: "metadata" };
		const baseMatchedTerms = query.terms.map((term) =>
			entry.baseChunks.some((chunk) => chunk.includes(term)),
		);
		if (baseMatchedTerms.every(Boolean)) return { source: "metadata" };
		const baseKey = baseMatchedTerms.map(Number).join("");
		let state = entry.queryStates.get(query.key);
		if (!state) {
			state = { baseKey, historyCursor: 0, match: null };
		} else {
			entry.queryStates.delete(query.key);
			if (state.baseKey !== baseKey) {
				state.baseKey = baseKey;
				state.historyCursor = 0;
				state.match = null;
			}
		}
		entry.queryStates.set(query.key, state);
		while (entry.queryStates.size > MAX_CACHED_QUERIES) {
			const oldest = entry.queryStates.keys().next().value;
			if (oldest === undefined) break;
			entry.queryStates.delete(oldest);
		}

		if (state.match) return state.match;
		const requiredTerms = query.terms.filter(
			(_term, index) => !baseMatchedTerms[index],
		);
		for (
			let messageIndex = state.historyCursor;
			messageIndex < entry.historyMessages.length;
			messageIndex += 1
		) {
			const message = entry.historyMessages[messageIndex];
			if (message === undefined) continue;
			if (
				!requiredTerms.every((term) =>
					message.parts.some((part) =>
						part.normalized.includes(term),
					),
				)
			) {
				continue;
			}
			let preview = message.parts[0]?.text ?? "";
			let previewScore = 0;
			for (const part of message.parts) {
				const score = requiredTerms.filter((term) =>
					part.normalized.includes(term),
				).length;
				if (score > previewScore) {
					preview = searchMatchPreview(part.text, requiredTerms);
					previewScore = score;
				}
			}
			state.historyCursor = messageIndex + 1;
			state.match = {
				source: "message",
				messageId: message.messageId,
				preview,
			};
			return state.match;
		}
		state.historyCursor = entry.historyMessages.length;
		return null;
	}

	async #loadNextPage({
		conversationId,
		entry,
		isCurrent,
	}: {
		conversationId: string;
		entry: IndexEntry;
		isCurrent: () => boolean;
	}): Promise<void> {
		if (entry.inFlight) return await entry.inFlight;
		const requestedPageKey = entry.nextPageKey;
		const task = this.#limiter.run(async () => {
			if (!isCurrent()) return;
			const page = await this.loadPage({
				conversationId,
				...(typeof requestedPageKey === "string"
					? { pageKey: requestedPageKey }
					: {}),
			});
			this.#appendMessages(entry, page.messages);
			entry.nextPageKey =
				page.messages.length === 0 ||
				page.nextPageKey === requestedPageKey
					? null
					: page.nextPageKey;
		});
		entry.inFlight = task.finally(() => {
			entry.inFlight = null;
		});
		await entry.inFlight;
	}

	#appendMessages(entry: IndexEntry, messages: ApiResponseMessage[]): void {
		for (const message of messages) {
			if (entry.messageIds.has(message.messageId)) continue;
			entry.messageIds.add(message.messageId);
			const parts = messageSearchTextValues(message)
				.map((text) => ({
					text,
					normalized: normalizeSearchText(text),
				}))
				.filter((part) => part.normalized.length > 0);
			if (parts.length > 0) {
				entry.historyMessages.push({
					messageId: message.messageId,
					parts,
				});
			}
		}
	}
}
