import { page } from "$app/state";
import z from "zod";

import { showErrorToast } from "$lib/api/error";
import {
	deleteConversationForMe,
	getConversations,
	markConversationAsRead,
	setConversationMuted,
	setConversationPinned,
} from "$lib/api/messaging/conversations";
import { getConversationMessages } from "$lib/api/messaging/messages";
import {
	type FailedCachedMessage,
	readCachedInbox,
	readCachedConversation as readPersistedConversation,
	removeCachedConversation,
	writeCachedInbox,
	writeCachedConversation as writePersistedConversation,
} from "$lib/app-data/chat-cache";
import {
	getShowRetractedMessagesSnapshot,
	subscribePreferences,
} from "$lib/app-data/preferences.svelte";
import { showIncomingMessageToast } from "$lib/components/incoming-message-toast/incoming-message-toast-manager";
import { previewFromMessage } from "$lib/model/messaging/messages";
import { below } from "$lib/util/breakpoints.svelte";
import { reconciler } from "$lib/util/reconcile";
import {
	chatV1ConversationDeleteEventSchema,
	chatV1MessageSentEventSchema,
	ws,
} from "$lib/ws.svelte";
import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";
import {
	conversationRowMatchesQuery,
	messageCorpusMatchesQuery,
	normalizeConversationSearchQuery,
	searchableMessageText,
} from "./conversation-filter";

type OptimisticFlagField = "pinned" | "muted";
type MessageSearchStatus = "idle" | "searching" | "complete" | "partial";

type MessageSearchCorpus = {
	complete: boolean;
	initialized: boolean;
	nextPageKey?: string | null;
	pageKeys: Set<string>;
	textByMessageId: Map<string, string>;
	retractedMessageIds: Set<string>;
};

const MESSAGE_SEARCH_CONCURRENCY = 3;

export type CachedConversation = {
	messages: ApiResponseMessage[];
	failedMessages?: FailedCachedMessage[];
	profile: {
		distance: number | null;
		mediaHash: string | null;
		name: string | null;
		onlineUntil: number | null;
		profileId: number;
		showDistance: boolean;
	};
	pageKey: string | null;
	lastReadTimestamp: number | null;
};

class ConversationsState {
	entries = $state<Conversation[]>([]);
	nextPage = $state<number | null>(null);
	loadingMore = $state(false);
	refreshing = $state(false);
	inboxLastViewedAt = $state(0);
	initial: Promise<void> = $state(Promise.resolve());
	listScrollY = 0;
	messageSearchQuery = $state("");
	messageSearchMatchIds = $state<string[]>([]);
	messageSearchStatus = $state<MessageSearchStatus>("idle");
	messageSearchScanned = $state(0);
	messageSearchTotal = $state(0);
	messageSearchFailureCount = $state(0);
	failedConversationIds = $state<string[]>([]);

	readonly ourProfileId: number;
	#activeConversationId: string | null = null;
	#wsPromises: Promise<() => void>[] = [];
	#messageCache = new Map<string, CachedConversation>();
	#unsubscribeReconcile: () => void;
	#destroyed = false;
	#pendingFlags = new Map<string, Map<OptimisticFlagField, number>>();
	#pendingDeletes = new Map<
		string,
		{ refs: number; inFlight: number; lastSettledEpoch: number }
	>();
	#inFlightFetches = new Set<Promise<unknown>>();
	#fetchEpoch = 0;
	#syncLatestInFlight: Promise<void> | null = null;
	#messageSearchAbortController: AbortController | null = null;
	#messageSearchCorpora = new Map<string, MessageSearchCorpus>();
	#messageSearchEpoch = 0;
	#messageSearchFetches = new Map<string, Promise<void>>();
	#messageSearchActiveRequests = 0;
	#messageSearchSlotWaiters: (() => void)[] = [];
	#unsubscribePreferences: () => void;

	constructor(ourProfileId: number) {
		this.ourProfileId = ourProfileId;
		this.inboxLastViewedAt = this.#loadInboxLastViewed();
		this.initial = this.#trackFetch(this.#initialize());

		this.#unsubscribeReconcile = reconciler.subscribe(() =>
			this.#trackFetch(this.#reconcile()),
		);
		this.#unsubscribePreferences = subscribePreferences(() => {
			for (const entry of this.entries) {
				this.#refreshCurrentSearchMatch(entry.data.conversationId);
			}
		});

		this.#wsPromises.push(
			ws.on("chat.v1.message_sent", chatV1MessageSentEventSchema, (event) => {
				if (this.#destroyed) return;
				void this.#handleMessageSent(event.payload);
			}),
			ws.on(
				"chat.v1.conversation.delete",
				chatV1ConversationDeleteEventSchema,
				(event) => {
					if (this.#destroyed) return;
					for (const id of event.payload.conversationIds) {
						this.remove(id);
						this.#markServerDeleted(id);
					}
				},
			),
		);
	}

	async #initialize(): Promise<void> {
		const cached = await readCachedInbox(this.ourProfileId).catch((error) => {
			console.error("Inbox cache hydration failed", error);
			return null;
		});
		if (this.#destroyed) return;
		if (cached) {
			this.entries = cached.entries;
			this.nextPage = cached.nextPage;
			this.failedConversationIds = cached.failedConversationIds;
		}
		try {
			await this.#load(1);
		} catch (error) {
			if (!cached) throw error;
			console.error("Inbox network refresh failed", error);
			showErrorToast({ label: "Showing cached conversations", error });
		}
	}

	async destroy(): Promise<void> {
		this.#destroyed = true;
		this.cancelMessageSearch();
		this.#messageSearchCorpora.clear();
		this.#messageSearchFetches.clear();
		this.#unsubscribeReconcile();
		this.#unsubscribePreferences();
		const unlisteners = await Promise.all(this.#wsPromises);
		for (const unlisten of unlisteners) unlisten();
		this.#wsPromises = [];
	}

	async #handleMessageSent(message: ApiResponseMessage): Promise<void> {
		this.#mergeSearchMessages(message.conversationId, [message]);
		const isActive = message.conversationId === this.#activeConversationId;
		const isIncoming = message.senderId !== this.ourProfileId;
		let entry = this.#find(message.conversationId);

		if (entry && message.timestamp <= entry.data.lastActivityTimestamp) {
			if (!isActive) this.invalidateConversation(message.conversationId);
			return;
		}

		if (entry) {
			if (!isActive && isIncoming) {
				entry.data.unreadCount += 1;
			}
			if (!isActive) {
				this.invalidateConversation(message.conversationId);
			}
			this.updatePreview({
				conversationId: message.conversationId,
				preview: previewFromMessage(message),
				timestamp: message.timestamp,
			});
		} else {
			await this.ensureLoaded(message.conversationId);
			entry = this.#find(message.conversationId);
		}
		const isInboxPageRoot = page.route.id === "/(protected)/chat";
		const twoColLayout = !below("split").current;
		const isConversationsListVisible = isInboxPageRoot || twoColLayout;
		if (
			isIncoming &&
			!isActive &&
			entry &&
			!entry.data.muted &&
			!isConversationsListVisible
		) {
			this.#showIncomingMessageToast({ message, conversation: entry });
		}
	}

	async #reconcile(): Promise<void> {
		if (this.#destroyed || this.refreshing) return;
		this.refreshing = true;
		try {
			await this.initial.catch(() => {});
			// Claim the epoch after initial resolves, or a still-loading initial
			// #load sees a newer epoch and drops its own result.
			const fetchEpoch = ++this.#fetchEpoch;

			const activeId = this.#activeConversationId;
			for (const id of [...this.#messageCache.keys()]) {
				if (id !== activeId) this.#messageCache.delete(id);
			}

			const oldestLoadedTs = this.entries.reduce(
				(min, e) => Math.min(min, e.data.lastActivityTimestamp),
				Number.POSITIVE_INFINITY,
			);
			const fetched = new Map<string, Conversation>();
			let oldestFetchedTs = Number.POSITIVE_INFINITY;
			let page: number | null = 1;
			let reachedEnd = false;
			for (let guard = 0; page !== null && guard < 100; guard++) {
				const currentPage: number = page;
				const result = await getConversations(currentPage);
				for (const entry of result.entries) {
					if (!fetched.has(entry.data.conversationId)) {
						fetched.set(entry.data.conversationId, entry);
					}
					oldestFetchedTs = Math.min(
						oldestFetchedTs,
						entry.data.lastActivityTimestamp,
					);
				}
				page = result.nextPage;
				if (page === null) {
					reachedEnd = true;
					break;
				}
				if (oldestFetchedTs <= oldestLoadedTs) break;
			}
			if (this.#isStale(fetchEpoch)) return;
			this.nextPage = reachedEnd ? null : page;

			for (const incoming of fetched.values()) {
				const existing = this.#find(incoming.data.conversationId);
				if (existing) {
					this.#mergeIncoming(existing, incoming);
				} else if (
					!this.#isPendingDelete(incoming.data.conversationId, fetchEpoch)
				) {
					this.entries.push(incoming);
				}
			}

			const windowFloor = reachedEnd
				? Number.NEGATIVE_INFINITY
				: oldestFetchedTs;
			for (const entry of [...this.entries]) {
				const id = entry.data.conversationId;
				if (fetched.has(id)) continue;
				if (this.#isPendingDelete(id, fetchEpoch)) continue;
				if (entry.data.lastActivityTimestamp > windowFloor) {
					this.remove(id);
				}
			}

			this.#sortEntries();
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to refresh conversations",
				error,
			});
		} finally {
			this.refreshing = false;
		}
	}

	#syncLatest(args: { errorLabel: string }): Promise<void> {
		this.#syncLatestInFlight ??= this.#runSyncLatest(args).finally(() => {
			this.#syncLatestInFlight = null;
		});
		return this.#syncLatestInFlight;
	}

	async #runSyncLatest({ errorLabel }: { errorLabel: string }): Promise<void> {
		// Read, don't claim: syncLatest never writes nextPage, so #load/#reconcile
		// must not defer to it. It still guards its own write below.
		const fetchEpoch = this.#fetchEpoch;
		try {
			const result = await getConversations(1);
			if (this.#isStale(fetchEpoch)) return;
			for (const incoming of result.entries) {
				const existing = this.#find(incoming.data.conversationId);
				if (existing) {
					this.#mergeIncoming(existing, incoming);
				} else if (
					!this.#isPendingDelete(incoming.data.conversationId, fetchEpoch)
				) {
					this.entries.unshift(incoming);
				}
			}
			this.#sortEntries();
		} catch (error) {
			console.error(error);
			showErrorToast({ label: errorLabel, error });
		}
	}

	async #load(page: number): Promise<void> {
		const fetchEpoch = ++this.#fetchEpoch;
		const result = await getConversations(page);
		if (this.#isStale(fetchEpoch)) return;
		const known = new Set(this.entries.map((e) => e.data.conversationId));
		for (const entry of result.entries) {
			const conversationId = entry.data.conversationId;
			if (
				!known.has(conversationId) &&
				!this.#isPendingDelete(conversationId, fetchEpoch)
			) {
				this.entries.push(entry);
			}
		}
		this.nextPage = result.nextPage;
		this.#sortEntries();
	}

	#isStale(fetchEpoch: number): boolean {
		return fetchEpoch !== this.#fetchEpoch;
	}

	#trackFetch<T>(fetch: Promise<T>): Promise<T> {
		this.#inFlightFetches.add(fetch);
		void fetch
			.catch(() => {})
			.finally(() => this.#inFlightFetches.delete(fetch));
		return fetch;
	}

	refresh(): Promise<void> {
		return this.#trackFetch(this.#reconcile());
	}

	retry(): void {
		if (this.#destroyed) return;
		this.entries = [];
		this.nextPage = null;
		this.initial = this.#trackFetch(this.#load(1));
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.nextPage === null) return;
		this.loadingMore = true;
		try {
			await this.#trackFetch(this.#load(this.nextPage));
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to load more conversations",
				error,
			});
		} finally {
			this.loadingMore = false;
		}
	}

	async ensureLoaded(conversationId: string): Promise<void> {
		if (this.#find(conversationId)) return;
		await this.#trackFetch(
			this.#syncLatest({
				errorLabel: "Failed to sync conversation into sidebar",
			}),
		);
	}

	remove(conversationId: string) {
		this.#messageCache.delete(conversationId);
		void removeCachedConversation(this.ourProfileId, conversationId);
		this.#messageSearchCorpora.delete(conversationId);
		this.messageSearchMatchIds = this.messageSearchMatchIds.filter(
			(id) => id !== conversationId,
		);
		const index = this.entries.findIndex(
			(e) => e.data.conversationId === conversationId,
		);
		let revert = () => {};
		if (index > -1) {
			const [removed] = this.entries.splice(index, 1);
			revert = () => {
				if (removed && !this.#find(conversationId)) {
					this.entries.splice(Math.min(index, this.entries.length), 0, removed);
				}
			};
		}
		return {
			revert,
		};
	}

	setActive(conversationId: string): void {
		this.#activeConversationId = conversationId;
		void this.markRead(conversationId);
	}

	clearActive(conversationId: string): void {
		if (this.#activeConversationId === conversationId) {
			this.#activeConversationId = null;
		}
	}

	get hasUnread(): boolean {
		return this.entries.some(
			(entry) =>
				entry.data.unreadCount > 0 &&
				!entry.data.muted &&
				entry.data.lastActivityTimestamp > this.inboxLastViewedAt,
		);
	}

	markInboxViewed(): void {
		const now = Date.now();
		if (now <= this.inboxLastViewedAt) return;
		this.inboxLastViewedAt = now;
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(this.#inboxStorageKey(), String(now));
		}
	}

	#inboxStorageKey(): string {
		return `chat:inbox-last-viewed:${this.ourProfileId}`;
	}

	#loadInboxLastViewed(): number {
		if (typeof localStorage === "undefined") return 0;
		return (
			z.coerce
				.number()
				.int()
				.nonnegative()
				.safeParse(localStorage.getItem(this.#inboxStorageKey())).data ?? 0
		);
	}

	#showIncomingMessageToast({
		message,
		conversation,
	}: {
		message: ApiResponseMessage;
		conversation: Conversation;
	}): void {
		showIncomingMessageToast({
			message,
			sender: {
				name: conversation.data.name,
				avatarMediaHash: conversation.data.participants[0].primaryMediaHash,
			},
			conversationId: conversation.data.conversationId,
		});
	}

	async markRead(conversationId: string) {
		const entry = this.#find(conversationId);
		if (entry) {
			const clearedCount = entry.data.unreadCount;
			if (clearedCount > 0) {
				entry.data.unreadCount = 0;
				try {
					await markConversationAsRead({ conversationId });
				} catch (error) {
					console.error(error);
					showErrorToast({
						label: "Failed to mark conversation as read",
						error,
					});
					entry.data.unreadCount += clearedCount;
				}
			}
		}
	}

	async #requestWithRollback<T>({
		items,
		request,
		rollback,
		errorLabel,
	}: {
		items: T[];
		request: (item: T) => Promise<unknown>;
		rollback: (item: T) => void;
		errorLabel: string;
	}): Promise<void> {
		const results = await Promise.allSettled(items.map(request));
		const failures: T[] = [];
		let error: unknown = null;
		results.forEach((result, index) => {
			if (result.status !== "rejected") return;
			failures.push(items[index]);
			error ??= result.reason;
		});
		if (failures.length === 0) return;
		for (const item of failures.toReversed()) rollback(item);
		this.#sortEntries();
		console.error(error);
		showErrorToast({ label: errorLabel, error });
	}

	#markPendingFlag(conversationId: string, field: OptimisticFlagField): void {
		const counts =
			this.#pendingFlags.get(conversationId) ??
			new Map<OptimisticFlagField, number>();
		counts.set(field, (counts.get(field) ?? 0) + 1);
		this.#pendingFlags.set(conversationId, counts);
	}

	#unmarkPendingFlag(conversationId: string, field: OptimisticFlagField): void {
		const counts = this.#pendingFlags.get(conversationId);
		const count = counts?.get(field);
		if (counts === undefined || count === undefined) return;
		if (count > 1) {
			counts.set(field, count - 1);
		} else {
			counts.delete(field);
			if (counts.size === 0) this.#pendingFlags.delete(conversationId);
		}
	}

	async #setFlag({
		conversationIds,
		field,
		value,
		request,
		errorLabel,
	}: {
		conversationIds: string[];
		field: OptimisticFlagField;
		value: boolean;
		request: (conversationId: string) => Promise<unknown>;
		errorLabel: string;
	}): Promise<void> {
		const targets = conversationIds
			.map((id) => this.#find(id))
			.filter(
				(entry): entry is Conversation =>
					entry !== undefined && entry.data[field] !== value,
			);
		if (targets.length === 0) return;
		for (const entry of targets) {
			entry.data[field] = value;
			this.#markPendingFlag(entry.data.conversationId, field);
		}
		if (field === "pinned") this.#sortEntries();

		try {
			await this.#requestWithRollback({
				items: targets,
				request: (entry) => request(entry.data.conversationId),
				rollback: (entry) => {
					entry.data[field] = !value;
				},
				errorLabel,
			});
		} finally {
			for (const entry of targets) {
				this.#unmarkPendingFlag(entry.data.conversationId, field);
			}
		}
	}

	setPinned(conversationIds: string[], pinned: boolean): Promise<void> {
		return this.#setFlag({
			conversationIds,
			field: "pinned",
			value: pinned,
			request: (conversationId) =>
				setConversationPinned({ conversationId, pinned }),
			errorLabel: pinned
				? "Failed to pin conversation"
				: "Failed to unpin conversation",
		});
	}

	setMuted(conversationIds: string[], muted: boolean): Promise<void> {
		return this.#setFlag({
			conversationIds,
			field: "muted",
			value: muted,
			request: (conversationId) =>
				setConversationMuted({ conversationId, muted }),
			errorLabel: muted
				? "Failed to mute conversation"
				: "Failed to unmute conversation",
		});
	}

	#markPendingDelete(conversationId: string): void {
		const tombstone = this.#pendingDeletes.get(conversationId) ?? {
			refs: 0,
			inFlight: 0,
			lastSettledEpoch: -1,
		};
		tombstone.refs += 1;
		tombstone.inFlight += 1;
		this.#pendingDeletes.set(conversationId, tombstone);
	}

	#settlePendingDelete(conversationId: string): void {
		const tombstone = this.#pendingDeletes.get(conversationId);
		if (tombstone === undefined) return;
		tombstone.inFlight -= 1;
		tombstone.lastSettledEpoch = this.#fetchEpoch;
	}

	#releasePendingDelete(conversationId: string): void {
		const tombstone = this.#pendingDeletes.get(conversationId);
		if (tombstone === undefined) return;
		tombstone.refs -= 1;
		if (tombstone.refs === 0) {
			this.#pendingDeletes.delete(conversationId);
		}
	}

	#isPendingDelete(conversationId: string, fetchEpoch: number): boolean {
		const tombstone = this.#pendingDeletes.get(conversationId);
		if (tombstone === undefined) return false;
		return tombstone.inFlight > 0 || fetchEpoch <= tombstone.lastSettledEpoch;
	}

	#markServerDeleted(conversationId: string): void {
		this.#markPendingDelete(conversationId);
		this.#settlePendingDelete(conversationId);
		void Promise.allSettled([...this.#inFlightFetches]).then(() =>
			this.#releasePendingDelete(conversationId),
		);
	}

	async deleteConversations(conversationIds: string[]): Promise<void> {
		for (const id of conversationIds) this.#markPendingDelete(id);
		try {
			await this.#requestWithRollback({
				items: conversationIds.map((conversationId) => ({
					conversationId,
					revert: this.remove(conversationId).revert,
				})),
				request: ({ conversationId }) =>
					deleteConversationForMe({ conversationId }),
				rollback: ({ revert }) => revert(),
				errorLabel: "Failed to delete conversation",
			});
		} finally {
			for (const id of conversationIds) this.#settlePendingDelete(id);
			void Promise.allSettled([...this.#inFlightFetches]).then(() => {
				for (const id of conversationIds) this.#releasePendingDelete(id);
			});
		}
	}

	updatePreview({
		conversationId,
		preview,
		timestamp,
	}: {
		conversationId: Conversation["data"]["conversationId"];
		preview: Conversation["data"]["preview"];
		timestamp: Conversation["data"]["lastActivityTimestamp"];
	}): void {
		const entry = this.#find(conversationId);
		if (!entry) return;
		entry.data.preview = preview;
		entry.data.lastActivityTimestamp = timestamp;
		this.#sortEntries();
	}

	#find(conversationId: string): Conversation | undefined {
		return this.entries.find((e) => e.data.conversationId === conversationId);
	}

	#mergeIncoming(existing: Conversation, incoming: Conversation): void {
		if (
			incoming.data.lastActivityTimestamp > existing.data.lastActivityTimestamp
		) {
			this.#invalidateSearchCorpus(incoming.data.conversationId);
		}
		const { unreadCount, ...data } = incoming.data;
		const pendingFlags = this.#pendingFlags.get(incoming.data.conversationId);
		for (const field of pendingFlags?.keys() ?? []) {
			data[field] = existing.data[field];
		}
		Object.assign(existing.data, data);
		if (incoming.data.conversationId !== this.#activeConversationId) {
			existing.data.unreadCount = unreadCount;
		}
	}

	#sortEntries(): void {
		this.entries = this.entries.toSorted(
			(a, b) =>
				Number(b.data.pinned) - Number(a.data.pinned) ||
				b.data.lastActivityTimestamp - a.data.lastActivityTimestamp,
		);
		this.#persistInbox();
	}

	#persistInbox(): void {
		void writeCachedInbox(
			this.ourProfileId,
			this.entries,
			this.nextPage,
			this.failedConversationIds,
		).catch((error) => console.error("Inbox cache write failed", error));
	}

	async getCachedConversation(
		id: string,
	): Promise<CachedConversation | undefined> {
		const memory = this.#messageCache.get(id);
		if (memory) return memory;
		const persisted = await readPersistedConversation(this.ourProfileId, id);
		if (!persisted) return undefined;
		const cached = {
			messages: persisted.messages,
			failedMessages: persisted.failedMessages,
			profile: persisted.profile,
			pageKey: persisted.pageKey,
			lastReadTimestamp: persisted.lastReadTimestamp,
		};
		this.#messageCache.set(id, cached);
		return cached;
	}

	setCachedConversation(id: string, data: CachedConversation): void {
		const normalized = { ...data, failedMessages: data.failedMessages ?? [] };
		this.#messageCache.set(id, normalized);
		const hasFailed = normalized.failedMessages.some(
			(message) => message.state === "failed",
		);
		if (hasFailed && !this.failedConversationIds.includes(id)) {
			this.failedConversationIds = [...this.failedConversationIds, id];
		} else if (!hasFailed && this.failedConversationIds.includes(id)) {
			this.failedConversationIds = this.failedConversationIds.filter(
				(conversationId) => conversationId !== id,
			);
		}
		this.#persistInbox();
		void writePersistedConversation(this.ourProfileId, id, {
			...normalized,
		}).catch((error) =>
			console.error("Conversation cache write failed", error),
		);
		const existingCorpus = this.#messageSearchCorpora.get(id);
		if (existingCorpus && data.pageKey === null) {
			const corpus: MessageSearchCorpus = {
				complete: true,
				initialized: true,
				nextPageKey: null,
				pageKeys: new Set(),
				textByMessageId: new Map(),
				retractedMessageIds: new Set(),
			};
			this.#messageSearchCorpora.set(id, corpus);
		} else if (existingCorpus && !existingCorpus.initialized) {
			existingCorpus.initialized = true;
			existingCorpus.nextPageKey = data.pageKey;
			if (data.pageKey !== null) {
				existingCorpus.pageKeys.add(data.pageKey);
			}
		}
		this.#mergeSearchMessages(id, data.messages);
	}

	invalidateConversation(id: string): void {
		this.#messageCache.delete(id);
	}

	#invalidateSearchCorpus(conversationId: string): void {
		this.#messageSearchCorpora.delete(conversationId);
		this.messageSearchMatchIds = this.messageSearchMatchIds.filter(
			(id) => id !== conversationId,
		);
	}

	removeMessageFromSearch(conversationId: string, messageId: string): void {
		const corpus = this.#messageSearchCorpora.get(conversationId);
		if (!corpus) return;
		corpus.textByMessageId.delete(messageId);
		this.#refreshCurrentSearchMatch(conversationId);
	}

	cancelMessageSearch(nextQuery = ""): void {
		const normalizedQuery = normalizeConversationSearchQuery(nextQuery);
		this.#messageSearchEpoch += 1;
		this.#messageSearchAbortController?.abort();
		this.#messageSearchAbortController = null;
		this.messageSearchQuery = normalizedQuery;
		this.messageSearchMatchIds = [];
		this.messageSearchStatus = normalizedQuery === "" ? "idle" : "searching";
		this.messageSearchScanned = 0;
		this.messageSearchTotal = 0;
		this.messageSearchFailureCount = 0;
	}

	async searchLoadedMessages(query: string): Promise<void> {
		const normalizedQuery = normalizeConversationSearchQuery(query);
		this.cancelMessageSearch(normalizedQuery);
		if (normalizedQuery === "" || this.#destroyed) return;

		const searchEpoch = ++this.#messageSearchEpoch;
		const abortController = new AbortController();
		this.#messageSearchAbortController = abortController;
		const candidates = this.entries.filter(
			(entry) => !conversationRowMatchesQuery(entry, normalizedQuery),
		);

		this.messageSearchQuery = normalizedQuery;
		this.messageSearchStatus = "searching";
		this.messageSearchTotal = candidates.length;
		await Promise.all(
			candidates.map((conversation) =>
				this.getCachedConversation(conversation.data.conversationId).catch(
					() => undefined,
				),
			),
		);
		if (this.#isMessageSearchStale(searchEpoch)) return;

		const targets: string[] = [];
		for (const conversation of candidates) {
			const conversationId = conversation.data.conversationId;
			const corpus = this.#seedSearchCorpus(conversationId);
			if (corpus.complete) {
				this.messageSearchScanned += 1;
			} else {
				targets.push(conversationId);
			}
		}
		this.#publishSearchMatches({
			candidates,
			normalizedQuery,
			searchEpoch,
		});

		let targetIndex = 0;
		const worker = async () => {
			while (targetIndex < targets.length) {
				const conversationId = targets[targetIndex++];
				try {
					await this.#ensureSearchCorpus(conversationId, abortController);
				} catch {
					if (
						abortController.signal.aborted ||
						this.#isMessageSearchStale(searchEpoch)
					) {
						return;
					}
					console.warn("Failed to search one loaded chat's message history");
					this.messageSearchFailureCount += 1;
				}
				if (this.#isMessageSearchStale(searchEpoch)) return;
				this.messageSearchScanned += 1;
				this.#publishSearchMatches({
					candidates,
					normalizedQuery,
					searchEpoch,
				});
			}
		};

		await Promise.all(
			Array.from(
				{ length: Math.min(MESSAGE_SEARCH_CONCURRENCY, targets.length) },
				() => worker(),
			),
		);
		if (this.#isMessageSearchStale(searchEpoch)) return;
		this.messageSearchStatus =
			this.messageSearchFailureCount > 0 ? "partial" : "complete";
		this.#messageSearchAbortController = null;
	}

	#isMessageSearchStale(searchEpoch: number): boolean {
		return this.#destroyed || searchEpoch !== this.#messageSearchEpoch;
	}

	#seedSearchCorpus(conversationId: string): MessageSearchCorpus {
		let corpus = this.#messageSearchCorpora.get(conversationId);
		if (!corpus) {
			corpus = {
				complete: false,
				initialized: false,
				pageKeys: new Set(),
				textByMessageId: new Map(),
				retractedMessageIds: new Set(),
			};
			this.#messageSearchCorpora.set(conversationId, corpus);
		}
		const cached = this.#messageCache.get(conversationId);
		if (!cached) return corpus;
		this.#mergeSearchMessages(conversationId, cached.messages);
		if (!corpus.initialized || cached.pageKey === null) {
			corpus.initialized = true;
			corpus.nextPageKey = cached.pageKey;
			corpus.complete = cached.pageKey === null;
			if (cached.pageKey !== null) corpus.pageKeys.add(cached.pageKey);
		}
		return corpus;
	}

	#mergeSearchMessages(
		conversationId: string,
		messages: readonly ApiResponseMessage[],
	): void {
		const corpus = this.#messageSearchCorpora.get(conversationId);
		if (!corpus) return;
		for (const message of messages) {
			if (message.type === "Retract") {
				corpus.retractedMessageIds.add(message.body.targetMessageId);
			}
		}
		for (const message of messages) {
			if (message.type === "Retract") continue;
			const text = searchableMessageText(message);
			if (text === null) {
				corpus.textByMessageId.delete(message.messageId);
			} else {
				corpus.textByMessageId.set(message.messageId, text);
			}
		}
		this.#refreshCurrentSearchMatch(conversationId);
	}

	#refreshCurrentSearchMatch(conversationId: string): void {
		const normalizedQuery = this.messageSearchQuery;
		if (normalizedQuery === "") return;
		const entry = this.#find(conversationId);
		const corpus = this.#messageSearchCorpora.get(conversationId);
		const matches =
			entry !== undefined &&
			!conversationRowMatchesQuery(entry, normalizedQuery) &&
			corpus !== undefined &&
			messageCorpusMatchesQuery(
				corpus.textByMessageId,
				corpus.retractedMessageIds,
				normalizedQuery,
				getShowRetractedMessagesSnapshot(),
			);
		const alreadyMatches = this.messageSearchMatchIds.includes(conversationId);
		if (matches && !alreadyMatches) {
			this.messageSearchMatchIds = [
				...this.messageSearchMatchIds,
				conversationId,
			];
		} else if (!matches && alreadyMatches) {
			this.messageSearchMatchIds = this.messageSearchMatchIds.filter(
				(id) => id !== conversationId,
			);
		}
	}

	async #ensureSearchCorpus(
		conversationId: string,
		abortController: AbortController,
	): Promise<void> {
		const existing = this.#messageSearchFetches.get(conversationId);
		if (existing) {
			try {
				await existing;
				return;
			} catch {
				if (abortController.signal.aborted) throw new Error("Search cancelled");
			}
		}
		const fetch = this.#hydrateSearchCorpus(conversationId, abortController);
		this.#messageSearchFetches.set(conversationId, fetch);
		try {
			await fetch;
		} finally {
			if (this.#messageSearchFetches.get(conversationId) === fetch) {
				this.#messageSearchFetches.delete(conversationId);
			}
		}
	}

	async #hydrateSearchCorpus(
		conversationId: string,
		abortController: AbortController,
	): Promise<void> {
		const corpus = this.#seedSearchCorpus(conversationId);
		while (!corpus.complete) {
			if (abortController.signal.aborted || this.#destroyed) {
				throw new Error("Search cancelled");
			}
			const pageKey = corpus.initialized
				? (corpus.nextPageKey ?? undefined)
				: undefined;
			const result = await this.#runMessageSearchRequest(abortController, () =>
				getConversationMessages({
					abortController,
					conversationId,
					pageKey,
				}),
			);
			if (abortController.signal.aborted || this.#destroyed) {
				throw new Error("Search cancelled");
			}
			corpus.initialized = true;
			this.#mergeSearchMessages(conversationId, result.messages);
			const cachedConversation = this.#messageCache.get(conversationId);
			if (cachedConversation) {
				this.setCachedConversation(conversationId, {
					...cachedConversation,
					messages: [...cachedConversation.messages, ...result.messages],
				});
			}
			const nextPageKey = result.messages.at(-1)?.messageId ?? null;
			if (nextPageKey === null) {
				corpus.complete = true;
				corpus.nextPageKey = null;
				continue;
			}
			if (corpus.pageKeys.has(nextPageKey)) {
				throw new Error("Conversation message pagination did not advance");
			}
			corpus.pageKeys.add(nextPageKey);
			corpus.nextPageKey = nextPageKey;
		}
	}

	async #runMessageSearchRequest<T>(
		abortController: AbortController,
		request: () => Promise<T>,
	): Promise<T> {
		if (this.#messageSearchActiveRequests < MESSAGE_SEARCH_CONCURRENCY) {
			this.#messageSearchActiveRequests += 1;
		} else {
			await new Promise<void>((resolve) => {
				this.#messageSearchSlotWaiters.push(resolve);
			});
		}
		try {
			if (abortController.signal.aborted || this.#destroyed) {
				throw new Error("Search cancelled");
			}
			return await request();
		} finally {
			const next = this.#messageSearchSlotWaiters.shift();
			if (next) {
				next();
			} else {
				this.#messageSearchActiveRequests -= 1;
			}
		}
	}

	#publishSearchMatches({
		candidates,
		normalizedQuery,
		searchEpoch,
	}: {
		candidates: readonly Conversation[];
		normalizedQuery: string;
		searchEpoch: number;
	}): void {
		if (this.#isMessageSearchStale(searchEpoch)) return;
		const loadedIds = new Set(
			this.entries.map((entry) => entry.data.conversationId),
		);
		this.messageSearchMatchIds = candidates
			.map((entry) => entry.data.conversationId)
			.filter((conversationId) => {
				if (!loadedIds.has(conversationId)) return false;
				const corpus = this.#messageSearchCorpora.get(conversationId);
				return (
					corpus !== undefined &&
					messageCorpusMatchesQuery(
						corpus.textByMessageId,
						corpus.retractedMessageIds,
						normalizedQuery,
						getShowRetractedMessagesSnapshot(),
					)
				);
			});
	}
}

export { ConversationsState };
