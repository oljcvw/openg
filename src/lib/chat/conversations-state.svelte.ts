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
import {
	type FailedCachedMessage,
	mergeConfirmedMessages,
	readCachedInbox,
	readCachedConversation as readPersistedConversation,
	removeCachedConversation,
	writeCachedInbox,
	writeCachedConversation as writePersistedConversation,
} from "$lib/app-data/chat-cache";
import {
	getDeveloperSettingsSnapshot,
	getShowRetractedMessagesSnapshot,
	subscribePreferences,
} from "$lib/app-data/preferences.svelte";
import { showIncomingMessageToast } from "$lib/components/incoming-message-toast/incoming-message-toast-manager";
import { runtimeOwnership } from "$lib/dev/runtime-ownership";
import { previewFromMessage } from "$lib/model/messaging/messages";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
import { below } from "$lib/util/breakpoints.svelte";
import { type ReconcileEvent, reconciler } from "$lib/util/reconcile";
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
type MessageSearchStatus = "idle" | "searching" | "complete";

type MessageSearchCorpus = {
	textByMessageId: Map<string, string>;
	retractedMessageIds: Set<string>;
};

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
	segments?: {
		segmentId: string;
		cursor: string | null;
		nextCursor: string | null;
		messageIds: string[];
	}[];
	removedMessageIds?: string[];
};

class ConversationsState {
	entries = $state<Conversation[]>([]);
	nextPage = $state<number | null>(null);
	loadingMore = $state(false);
	loadMoreError: unknown | null = $state(null);
	refreshing = $state(false);
	inboxLastViewedAt = $state(0);
	initial: Promise<void> = $state(Promise.resolve());
	messageSearchQuery = $state("");
	messageSearchMatchIds = $state<string[]>([]);
	messageSearchStatus = $state<MessageSearchStatus>("idle");
	messageSearchScanned = $state(0);
	messageSearchTotal = $state(0);
	failedConversationIds = $state<string[]>([]);

	readonly ourProfileId: number;

	sharedAlbumsHint(conversationId: string): boolean | null {
		return (
			this.entries.find((entry) => entry.data.conversationId === conversationId)
				?.data.metadata?.hasSharedAlbums ?? null
		);
	}
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
	#messageSearchCorpora = new Map<string, MessageSearchCorpus>();
	#messageSearchEpoch = 0;
	#unsubscribePreferences: () => void;
	#releaseOwnership = runtimeOwnership.acquire("conversation-state");

	constructor(ourProfileId: number) {
		this.ourProfileId = ourProfileId;
		this.inboxLastViewedAt = this.#loadInboxLastViewed();
		this.initial = this.#trackFetch(this.#initialize());

		this.#unsubscribeReconcile = reconciler.subscribe(
			"inbox",
			(event: ReconcileEvent) => {
				const requiresFullReconcile =
					event.reasons.has("events-dropped") ||
					(event.reasons.has("server-signal") &&
						event.scopes.size === 1 &&
						event.scopes.has("inbox"));
				return this.#trackFetch(
					requiresFullReconcile
						? this.#reconcile()
						: this.#syncLatest({
								errorLabel: "Failed to sync latest conversations",
							}),
				);
			},
		);
		this.#unsubscribePreferences = subscribePreferences(() => {
			for (const entry of this.entries) {
				this.#refreshCurrentSearchMatch(entry.data.conversationId);
			}
		});

		this.#wsPromises.push(
			this.#trackWebsocketListener(
				ws.on("chat.v1.message_sent", chatV1MessageSentEventSchema, (event) => {
					if (this.#destroyed) return;
					void this.#handleMessageSent(event.payload);
				}),
			),
			this.#trackWebsocketListener(
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
			),
		);
	}

	async #trackWebsocketListener(
		pending: Promise<() => void>,
	): Promise<() => void> {
		const release = runtimeOwnership.acquire("websocket-listener");
		try {
			const unlisten = await pending;
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				try {
					unlisten();
				} finally {
					release();
				}
			};
		} catch (error) {
			release();
			throw error;
		}
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
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#releaseOwnership();
		this.cancelMessageSearch();
		this.#messageSearchCorpora.clear();
		this.#unsubscribeReconcile();
		this.#unsubscribePreferences();
		const registrations = await Promise.allSettled(this.#wsPromises);
		const failures: unknown[] = [];
		for (const registration of registrations) {
			if (registration.status === "rejected") {
				failures.push(registration.reason);
				continue;
			}
			try {
				registration.value();
			} catch (error) {
				failures.push(error);
			}
		}
		this.#wsPromises = [];
		if (failures.length > 0)
			throw new AggregateError(failures, "WebSocket listener cleanup failed");
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
			if (isIncoming) {
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
		return this.#destroyed || fetchEpoch !== this.#fetchEpoch;
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
		this.loadMoreError = null;
		this.initial = this.#trackFetch(this.#load(1));
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.nextPage === null) return;
		this.loadingMore = true;
		this.loadMoreError = null;
		try {
			await this.#trackFetch(this.#load(this.nextPage));
		} catch (error) {
			console.error(error);
			this.loadMoreError = error;
		} finally {
			this.loadingMore = false;
		}
	}

	async retryLoadMore(): Promise<void> {
		this.loadMoreError = null;
		await this.loadMore();
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
		const revert = this.markReadLocally(conversationId);
		try {
			await markConversationAsRead({ conversationId });
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to mark conversation as read",
				error,
			});
			revert();
		}
	}

	markReadLocally(conversationId: string): () => void {
		const entry = this.#find(conversationId);
		const clearedCount = entry?.data.unreadCount ?? 0;
		if (entry && clearedCount > 0) entry.data.unreadCount = 0;
		let reverted = false;
		return () => {
			if (reverted || clearedCount === 0) return;
			reverted = true;
			const current = this.#find(conversationId);
			if (current) current.data.unreadCount += clearedCount;
		};
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
		if (this.#destroyed) return;
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
		if (memory) {
			this.#messageCache.delete(id);
			this.#messageCache.set(id, memory);
			return memory;
		}
		const persisted = await readPersistedConversation(
			this.ourProfileId,
			id,
		).catch(() => {
			console.error("Conversation cache hydration failed");
			reportClientDiagnostic({
				category: "cache_recovery",
				component: "conversation",
				code: "bypassed_unreadable_cache",
				level: "warning",
			});
			return null;
		});
		if (!persisted) return undefined;
		const cached = {
			messages: persisted.messages,
			failedMessages: persisted.failedMessages,
			profile: persisted.profile,
			pageKey: persisted.pageKey,
			lastReadTimestamp: persisted.lastReadTimestamp,
			segments: persisted.segments,
		};
		this.#messageCache.set(id, cached);
		this.#trimConversationCache();
		return cached;
	}

	setCachedConversation(id: string, data: CachedConversation): void {
		const current = this.#messageCache.get(id);
		const removedMessageIds = new Set(data.removedMessageIds ?? []);
		const normalized = {
			...data,
			messages: mergeConfirmedMessages(
				current?.messages ?? [],
				data.messages,
				removedMessageIds,
			),
			failedMessages: data.failedMessages ?? [],
			segments: data.segments ?? current?.segments ?? [],
		};
		delete normalized.removedMessageIds;
		this.#messageCache.set(id, normalized);
		this.#trimConversationCache();
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
		const corpus = this.#messageSearchCorpora.get(id);
		if (corpus) {
			corpus.textByMessageId.clear();
			corpus.retractedMessageIds.clear();
		}
		this.#mergeSearchMessages(id, data.messages);
	}

	#trimConversationCache(): void {
		const maximumNonactive = 20;
		while (
			this.#messageCache.size >
			maximumNonactive + (this.#activeConversationId === null ? 0 : 1)
		) {
			const oldest = this.#messageCache.keys().next().value;
			if (oldest === undefined) return;
			if (oldest === this.#activeConversationId) {
				const active = this.#messageCache.get(oldest);
				this.#messageCache.delete(oldest);
				if (active) this.#messageCache.set(oldest, active);
				continue;
			}
			this.#messageCache.delete(oldest);
		}
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
		this.messageSearchQuery = normalizedQuery;
		this.messageSearchMatchIds = [];
		this.messageSearchStatus = normalizedQuery === "" ? "idle" : "searching";
		this.messageSearchScanned = 0;
		this.messageSearchTotal = 0;
		if (normalizedQuery === "") this.#messageSearchCorpora.clear();
	}

	async searchLoadedMessages(query: string): Promise<void> {
		const normalizedQuery = normalizeConversationSearchQuery(query);
		this.cancelMessageSearch(normalizedQuery);
		if (normalizedQuery === "" || this.#destroyed) return;

		const searchEpoch = ++this.#messageSearchEpoch;
		const candidates = this.entries.filter(
			(entry) => !conversationRowMatchesQuery(entry, normalizedQuery),
		);

		this.messageSearchQuery = normalizedQuery;
		this.messageSearchStatus = "searching";
		this.messageSearchTotal = candidates.length;
		let nextCandidate = 0;
		const concurrency = Math.min(
			candidates.length,
			getDeveloperSettingsSnapshot().conversationSearchConcurrency,
		);
		await Promise.all(
			Array.from({ length: concurrency }, async () => {
				while (!this.#isMessageSearchStale(searchEpoch)) {
					const candidate = candidates[nextCandidate++];
					if (!candidate) return;
					const id = candidate.data.conversationId;
					await this.getCachedConversation(id).catch(() => undefined);
					if (this.#isMessageSearchStale(searchEpoch)) return;
					this.#seedSearchCorpus(id);
					if (id !== this.#activeConversationId) this.#messageCache.delete(id);
					this.messageSearchScanned += 1;
				}
			}),
		);
		if (this.#isMessageSearchStale(searchEpoch)) return;
		this.#publishSearchMatches({
			candidates,
			normalizedQuery,
			searchEpoch,
		});

		if (this.#isMessageSearchStale(searchEpoch)) return;
		this.messageSearchStatus = "complete";
	}

	#isMessageSearchStale(searchEpoch: number): boolean {
		return this.#destroyed || searchEpoch !== this.#messageSearchEpoch;
	}

	#seedSearchCorpus(conversationId: string): MessageSearchCorpus {
		let corpus = this.#messageSearchCorpora.get(conversationId);
		if (!corpus) {
			corpus = {
				textByMessageId: new Map(),
				retractedMessageIds: new Set(),
			};
			this.#messageSearchCorpora.set(conversationId, corpus);
		}
		const cached = this.#messageCache.get(conversationId);
		if (!cached) return corpus;
		corpus.textByMessageId.clear();
		corpus.retractedMessageIds.clear();
		this.#mergeSearchMessages(conversationId, cached.messages);
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
