import { createContext } from "svelte";

import { ApiError } from "$lib/api";
import {
	type AccountSessionSnapshot,
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
	subscribeAccountGeneration,
} from "$lib/api/account-caches";
import { showErrorToast } from "$lib/api/error";
import { markConversationAsRead } from "$lib/api/messaging/conversations";
import { reactToMessage } from "$lib/api/messaging/messages";
import {
	getDeveloperSettingsSnapshot,
	getPreferences,
	getShowRetractedMessagesSnapshot,
	subscribePreferences,
} from "$lib/app-data/preferences.svelte";
import { ActiveMessageWindow } from "$lib/chat/active-message-window";
import { getDirectMessageSession } from "$lib/chat/direct-message-session";
import { VoiceNoteNavigatorState } from "$lib/chat/voice-note-navigator.svelte";
import {
	applyMessageRetractions,
	previewFromMessage,
} from "$lib/model/messaging/messages";
import { navigationMemory } from "$lib/navigation/navigation-memory";
import { now } from "$lib/util/clock";
import { reconciler } from "$lib/util/reconcile";
import {
	chatV1ConversationDeleteEventSchema,
	chatV1ConversationReadEventSchema,
	chatV1MessageSentEventSchema,
	ws,
} from "$lib/ws.svelte";
import type { ConversationsState } from "$lib/chat/conversations-state.svelte";
import type {
	ApiResponseMessage,
	DisplayMessage,
	Message as MessageType,
} from "$lib/model/messaging/messages";
import { getConversation } from "./messages";

export type OptimisticMessage = ApiResponseMessage & {
	status:
		| "queued"
		| "awaitingAck"
		| "confirming"
		| "sent"
		| "failed"
		| "handled";
	lastAttemptAt?: number;
	attemptRef?: string;
	outerCommandRef?: string;
	retryCount?: number;
};

export type SendOwnershipTransfer = {
	kind: "accepted";
	operationId: string;
};

function stripNestedReply(
	message: ApiResponseMessage,
): NonNullable<ApiResponseMessage["replyToMessage"]> {
	const { replyToMessage: _nested, ...preview } = message;
	void _nested;
	return preview;
}

function sameLegacyMessage(
	candidate: ApiResponseMessage,
	local: OptimisticMessage,
): boolean {
	if (
		candidate.type !== local.type ||
		candidate.replyToMessage?.messageId !== local.replyToMessage?.messageId
	)
		return false;
	switch (local.type) {
		case "Text":
			return (
				candidate.type === "Text" && candidate.body.text === local.body.text
			);
		case "Location":
			return (
				candidate.type === "Location" &&
				candidate.body.lat === local.body.lat &&
				candidate.body.lon === local.body.lon
			);
		case "Image":
		case "ExpiringImage":
			return (
				candidate.type === local.type &&
				candidate.body.mediaId === local.body.mediaId
			);
		case "Audio":
			return (
				candidate.type === "Audio" &&
				candidate.body.mediaId === local.body.mediaId
			);
		case "Video":
		case "PrivateVideo":
			return (
				candidate.type === local.type &&
				candidate.body.mediaId !== null &&
				candidate.body.mediaId === local.body.mediaId
			);
		case "Album":
		case "ExpiringAlbum":
		case "ExpiringAlbumV2":
			return (
				candidate.type === local.type &&
				candidate.body.albumId === local.body.albumId
			);
		case "AlbumContentReaction":
			return (
				candidate.type === "AlbumContentReaction" &&
				candidate.body.albumId === local.body.albumId &&
				candidate.body.albumContentId === local.body.albumContentId
			);
		case "AlbumContentReply":
			return (
				candidate.type === "AlbumContentReply" &&
				candidate.body.albumId === local.body.albumId &&
				candidate.body.albumContentId === local.body.albumContentId &&
				candidate.body.albumContentReply === local.body.albumContentReply
			);
		case "Giphy":
			return candidate.type === "Giphy" && candidate.body.id === local.body.id;
		case "Gaymoji":
			return (
				candidate.type === "Gaymoji" &&
				candidate.body.imageHash === local.body.imageHash
			);
		case "ProfilePhotoReply":
			return (
				candidate.type === "ProfilePhotoReply" &&
				candidate.body.imageHash === local.body.imageHash &&
				candidate.body.photoContentReply === local.body.photoContentReply
			);
		case "Retract":
			return (
				candidate.type === "Retract" &&
				candidate.body.targetMessageId === local.body.targetMessageId
			);
		default:
			return false;
	}
}

function sameAttemptReference(
	candidate: ApiResponseMessage,
	local: OptimisticMessage,
): boolean {
	if (!candidate.refValue) return false;
	return (
		candidate.refValue === local.attemptRef ||
		candidate.refValue === local.refValue
	);
}

const READ_DEBOUNCE_MS = 500;
const READ_MAX_WAIT_MS = 2000;

export type ConversationProfile = Awaited<
	ReturnType<typeof getConversation>
>["profile"];

export class ConversationState {
	messages: OptimisticMessage[] = $state([]);
	profile: ConversationProfile | null = $state(null);
	pageKey: string | null = $state(null);
	loading = $state(true);
	loadingMore = $state(false);
	loadingNewer = $state(false);
	newerSegmentId: string | null = $state(null);
	refreshing = $state(false);
	error: Error | null = $state(null);
	lastReadTimestamp: number | null = $state(null);
	replyTarget: ApiResponseMessage | null = $state(null);
	readonly voiceNotes = new VoiceNoteNavigatorState();

	readonly conversationId: string;
	readonly ourProfileId: number;
	readonly hasSharedAlbumsHint: boolean | null;
	readonly accountSession: AccountSessionSnapshot;

	#conversations: ConversationsState;
	#readQueue: { messageId: string; timestamp: number }[] = [];
	#readTimer: ReturnType<typeof setTimeout> | null = null;
	#readDeadline: number | null = null;
	#unsubscribeReconcile: () => void;
	#unsubscribePreferences: () => void;
	#unsubscribeAccountGeneration: () => void = () => {};
	#retryingMessageIds = new Set<string>();
	#voiceScan: Promise<void> | null = null;
	#removedMessageIds = new Set<string>();
	#messageWindow = new ActiveMessageWindow<OptimisticMessage>({
		maxFetchedPages: 8,
	});

	constructor({
		conversationId,
		ourProfileId,
		conversations,
	}: {
		conversationId: string;
		ourProfileId: number;
		conversations: ConversationsState;
	}) {
		this.conversationId = conversationId;
		this.ourProfileId = ourProfileId;
		this.accountSession = getAccountSessionSnapshot();
		this.#conversations = conversations;
		this.hasSharedAlbumsHint = conversations.sharedAlbumsHint(conversationId);
		conversations.setActive(conversationId);
		this.lastReadTimestamp = null;
		void this.#initialLoad();

		this.#unsubscribeReconcile = reconciler.subscribe(
			"conversation",
			(event) =>
				!event ||
				event.conversationIds.size === 0 ||
				event.conversationIds.has(this.conversationId)
					? this.#reconcileMessages()
					: undefined,
		);
		this.#unsubscribePreferences = subscribePreferences(() => {
			this.#updatePreviewFromMessages();
		});

		this.#wsPromises.push(
			ws.on("chat.v1.message_sent", chatV1MessageSentEventSchema, (event) => {
				if (!this.#isCurrentOwner()) return;
				const incoming = event.payload;
				if (incoming.conversationId !== this.conversationId) return;

				const existing = this.messages.find(
					(m) => m.messageId === incoming.messageId,
				);
				if (existing) {
					Object.assign(existing, incoming, { status: "sent" as const });
					this.#messageWindow.confirmOptimistic(existing.messageId, existing);
					this.#syncMessagesFromWindow();
					this.#syncCache();
					return;
				}

				if (incoming.senderId === this.ourProfileId) {
					const pending = this.#matchPendingEcho(incoming);
					if (pending) {
						const previousId = pending.messageId;
						pending.status = "sent";
						pending.messageId = incoming.messageId;
						this.#messageWindow.reconcileActive(this.messages);
						this.#messageWindow.confirmOptimistic(previousId, pending);
						this.#syncMessagesFromWindow();
						this.#syncCache();
						return;
					}
				}

				const newestTimestamp = this.messages.reduce(
					(max, m) => Math.max(max, m.timestamp),
					Number.NEGATIVE_INFINITY,
				);
				if (incoming.timestamp < newestTimestamp) return;

				const msg: OptimisticMessage = { ...incoming, status: "sent" };
				this.#messageWindow.upsertNewest(msg);
				this.#syncMessagesFromWindow();
				this.#syncCache();
			}),
			ws.on(
				"chat.v1.conversation_read",
				chatV1ConversationReadEventSchema,
				(event) => {
					if (!this.#isCurrentOwner()) return;
					if (event.payload.conversationId !== this.conversationId) return;
					if (event.payload.profileId === this.ourProfileId) return;
					if (this.#advanceLastRead(event.payload.timestamp)) this.#syncCache();
				},
			),
			ws.on(
				"chat.v1.conversation.delete",
				chatV1ConversationDeleteEventSchema,
				(event) => {
					if (!this.#isCurrentOwner()) return;
					if (!event.payload.conversationIds.includes(this.conversationId))
						return;
					void this.#reconcileMessages();
				},
			),
		);
		this.#unsubscribeAccountGeneration = subscribeAccountGeneration(
			(generation) => {
				if (generation !== this.accountSession.generation) this.destroy();
			},
		);
	}

	#wsPromises: Promise<() => void>[] = [];

	#destroyed = false;
	get destroyed(): boolean {
		return this.#destroyed;
	}
	#isCurrentOwner(): boolean {
		return !this.#destroyed && isAccountSessionCurrent(this.accountSession);
	}
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#conversations.clearActive(this.conversationId);
		for (const promise of this.#wsPromises) {
			promise.then((unlisten) => unlisten()).catch(console.error);
		}
		this.#wsPromises = [];
		this.#unsubscribeReconcile();
		this.#unsubscribePreferences();
		this.#unsubscribeAccountGeneration();
		if (this.#readTimer !== null) clearTimeout(this.#readTimer);
		if (this.#readQueue.length > 0) void this.#flushReadQueue();
		this.voiceNotes.exit();
	}

	async scanVoiceNotes(): Promise<void> {
		if (this.voiceNotes.scanComplete) return;
		if (this.#voiceScan !== null) return this.#voiceScan;
		this.voiceNotes.beginScan();
		this.voiceNotes.merge(this.messages);
		this.#voiceScan = (async () => {
			const seenCursors = new Set<string>();
			while (this.pageKey !== null && this.#isCurrentOwner()) {
				const cursor = this.pageKey;
				if (seenCursors.has(cursor)) break;
				seenCursors.add(cursor);
				const outcome = await this.loadMore();
				this.voiceNotes.merge(this.messages);
				if (outcome === "error") {
					this.voiceNotes.failScan();
					return;
				}
				if (outcome === "end") break;
				if (outcome === "busy") {
					// Another history consumer owns this cursor. It has not been
					// exhausted, so allow the scan to retry it after that flight settles.
					seenCursors.delete(cursor);
					await new Promise<void>((resolve) => setTimeout(resolve, 50));
					continue;
				}
			}
			if (this.#isCurrentOwner()) this.voiceNotes.completeScan();
		})().finally(() => (this.#voiceScan = null));
		return this.#voiceScan;
	}

	async #reconcileMessages(): Promise<void> {
		if (this.loading || !this.#isCurrentOwner() || this.refreshing) return;
		this.refreshing = true;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			if (!this.#isCurrentOwner()) return;

			this.profile = result.profile;

			const serverById = new Map(
				result.messages.map((m) => [m.messageId, m] as const),
			);
			const oldestServerTs =
				result.messages.length > 0
					? result.messages[result.messages.length - 1].timestamp
					: Number.POSITIVE_INFINITY;

			const newValue: OptimisticMessage[] = [];
			const seenLocalIds = new Set<string>();
			const claimedServerIds = new Set<string>();
			const duplicateWindowMs =
				getDeveloperSettingsSnapshot().messageDuplicateReconcileWindowMs;
			const confirmedOptimistic: Array<{
				previousId: string;
				message: OptimisticMessage;
			}> = [];
			let dropped = 0;
			let updated = 0;
			for (const local of this.messages) {
				if (local.status !== "sent") {
					let serverVersion = result.messages.find(
						(candidate) =>
							!claimedServerIds.has(candidate.messageId) &&
							candidate.senderId === this.ourProfileId &&
							sameAttemptReference(candidate, local),
					);
					if (
						serverVersion === undefined &&
						local.status === "confirming" &&
						local.attemptRef === undefined &&
						!local.refValue
					) {
						const previousAttemptAt = local.lastAttemptAt ?? local.timestamp;
						serverVersion = result.messages.find(
							(candidate) =>
								!claimedServerIds.has(candidate.messageId) &&
								candidate.senderId === this.ourProfileId &&
								sameLegacyMessage(candidate, local) &&
								candidate.timestamp >= previousAttemptAt - duplicateWindowMs &&
								candidate.timestamp <= Date.now() + duplicateWindowMs,
						);
					}
					if (serverVersion) {
						const confirmed = {
							...serverVersion,
							status: "sent" as const,
						};
						claimedServerIds.add(serverVersion.messageId);
						seenLocalIds.add(serverVersion.messageId);
						newValue.push(confirmed);
						confirmedOptimistic.push({
							previousId: local.messageId,
							message: confirmed,
						});
						updated++;
						continue;
					}
					newValue.push(local);
					continue;
				}
				seenLocalIds.add(local.messageId);
				const serverVersion = serverById.get(local.messageId);
				if (serverVersion) {
					claimedServerIds.add(serverVersion.messageId);
					newValue.push({ ...serverVersion, status: "sent" as const });
					if (
						serverVersion.unsent !== local.unsent ||
						serverVersion.type !== local.type ||
						JSON.stringify(serverVersion.reactions) !==
							JSON.stringify(local.reactions)
					) {
						updated++;
					}
				} else if (local.timestamp < oldestServerTs) {
					newValue.push(local);
				} else {
					dropped++;
					this.#removedMessageIds.add(local.messageId);
					this.#conversations.removeMessageFromSearch(
						this.conversationId,
						local.messageId,
					);
				}
			}

			const fresh: OptimisticMessage[] = [];
			for (const sv of result.messages) {
				if (
					seenLocalIds.has(sv.messageId) ||
					claimedServerIds.has(sv.messageId)
				)
					continue;
				const msg: OptimisticMessage = { ...sv, status: "sent" as const };
				newValue.push(msg);
				fresh.push(msg);
			}

			this.#advanceLastRead(result.lastReadTimestamp);

			if (fresh.length === 0 && dropped === 0 && updated === 0) {
				this.#syncCache();
				return;
			}

			this.#messageWindow.reconcileActive(removeDuplicateMessages(newValue));
			for (const confirmation of confirmedOptimistic) {
				this.#messageWindow.confirmOptimistic(
					confirmation.previousId,
					confirmation.message,
				);
			}
			this.#syncMessagesFromWindow();
			this.#restoreReplyTargetFromMemory();
			this.#updatePreview(this.messages.at(0));
			this.#syncCache();
		} catch (error) {
			if (!this.#isCurrentOwner()) return;
			console.error("Failed to reconcile messages", error);
			if (error instanceof ApiError && error.response?.status === 403) {
				this.error = error;
			} else {
				showErrorToast({
					label: "Failed to refresh messages",
					error,
				});
			}
		} finally {
			this.refreshing = false;
		}
	}

	refresh(): Promise<void> {
		return this.#reconcileMessages();
	}

	retry(): void {
		if (!this.#isCurrentOwner()) return;
		void this.#initialLoad();
	}

	async #initialLoad(): Promise<void> {
		const cached = await this.#conversations.getCachedConversation(
			this.conversationId,
		);
		if (this.#destroyed || !isAccountSessionCurrent(this.accountSession))
			return;
		if (cached) {
			const failed = (cached.failedMessages ?? []).map(
				({
					message,
					state,
					lastAttemptAt,
					attemptRef,
					outerCommandRef,
					retryCount,
				}) => ({
					...message,
					status:
						state === "queued" || state === "awaitingAck"
							? ("confirming" as const)
							: state,
					lastAttemptAt,
					attemptRef,
					outerCommandRef,
					retryCount,
				}),
			);
			const confirmed = cached.messages.map((m) => ({
				...m,
				status: "sent" as const,
			}));
			this.#hydrateMessageWindow({
				messages: confirmed,
				pageKey: cached.pageKey,
				segments: cached.segments,
			});
			for (const message of failed) {
				this.#messageWindow.pin(message, "optimistic");
			}
			this.#syncMessagesFromWindow();
			this.#restoreReplyTargetFromMemory();
			this.profile = cached.profile;
			this.pageKey = cached.pageKey;
			this.lastReadTimestamp = cached.lastReadTimestamp;
			this.loading = false;
			void this.#reconcileMessages();
			return;
		}
		this.loading = true;
		this.error = null;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			if (this.#destroyed || !isAccountSessionCurrent(this.accountSession))
				return;
			const confirmed = removeDuplicateMessages(
				result.messages.map((m) => ({
					...m,
					status: "sent" as const,
				})),
			);
			this.#messageWindow.clear();
			this.#messageWindow.addOlderPage({
				cursor: null,
				nextCursor: result.pageKey,
				messages: confirmed,
			});
			this.#syncMessagesFromWindow();
			this.#restoreReplyTargetFromMemory();
			this.profile = result.profile;
			this.pageKey = result.pageKey;
			this.#updatePreview(this.messages.at(0));
			this.#advanceLastRead(result.lastReadTimestamp);
			this.#syncCache();
		} catch (err) {
			if (!this.#isCurrentOwner()) return;
			this.error = err instanceof Error ? err : new Error(String(err));
		} finally {
			this.loading = false;
		}
	}

	async loadMore(): Promise<"loaded" | "end" | "busy" | "error"> {
		if (!this.#isCurrentOwner()) return "error";
		if (this.loadingMore) return "busy";
		if (this.pageKey === null) return "end";
		this.loadingMore = true;
		try {
			const cursor = this.pageKey;
			const result = await getConversation({
				conversationId: this.conversationId,
				pageKey: cursor,
			});
			if (!this.#isCurrentOwner()) return "error";
			this.#messageWindow.addOlderPage({
				cursor,
				nextCursor: result.pageKey,
				messages: result.messages.map((m) => ({
					...m,
					status: "sent" as const,
				})),
			});
			this.#syncMessagesFromWindow();
			this.pageKey = result.pageKey;
			this.#advanceLastRead(result.lastReadTimestamp);
			this.#syncCache();
			return "loaded";
		} catch (error) {
			if (!this.#isCurrentOwner()) return "error";
			console.error(error);
			if (error instanceof ApiError && error.response?.status === 403) {
				this.error = error;
			} else {
				showErrorToast({
					label: "Failed to load more messages",
					error,
				});
			}
			return "error";
		} finally {
			this.loadingMore = false;
		}
	}

	async locateMessage(messageId: string): Promise<number | null> {
		let location = this.#messageWindow.locateMessage(messageId);
		if (location.kind === "active") return location.index;
		if (location.kind === "evicted") {
			try {
				await this.#restoreKnownSegment(location.segmentId);
			} catch {
				return null;
			}
			location = this.#messageWindow.locateMessage(messageId);
			if (location.kind === "active") return location.index;
		}

		const seenCursors = new Set<string>();
		while (this.pageKey !== null) {
			const cursor = this.pageKey;
			if (seenCursors.has(cursor)) return null;
			seenCursors.add(cursor);
			const outcome = await this.loadMore();
			if (outcome !== "loaded") return null;
			location = this.#messageWindow.locateMessage(messageId);
			if (location.kind === "active") return location.index;
		}
		return null;
	}

	async loadNewer(): Promise<"loaded" | "end" | "busy" | "error"> {
		if (this.loadingNewer) return "busy";
		const segment = this.#messageWindow.getAdjacentNewerSegment();
		if (!segment) return "end";
		this.loadingNewer = true;
		try {
			return (await this.#restoreKnownSegment(segment.segmentId))
				? "loaded"
				: "end";
		} catch (error) {
			if (!this.#destroyed) {
				showErrorToast({
					label: "Failed to load newer messages",
					error,
				});
			}
			return "error";
		} finally {
			this.loadingNewer = false;
		}
	}

	pinMessage(
		messageId: string,
		reason: "selected" | "viewer" | "voice-note",
	): boolean {
		const message = this.#messageWindow.getMessage(messageId);
		if (!message) return false;
		this.#messageWindow.pin(message, reason);
		this.#syncMessagesFromWindow();
		return true;
	}

	unpinMessage(
		messageId: string,
		reason: "selected" | "viewer" | "voice-note",
	): void {
		this.#messageWindow.unpin(messageId, reason);
		this.#syncMessagesFromWindow();
	}

	setReplyTarget(message: ApiResponseMessage): void {
		if (message.conversationId !== this.conversationId) return;
		if (this.replyTarget)
			this.#messageWindow.unpin(this.replyTarget.messageId, "reply-target");
		const active = this.#messageWindow.getMessage(message.messageId);
		const target = active ?? {
			...message,
			status: "sent" as const,
		};
		this.replyTarget = target;
		if (active) this.#messageWindow.pin(active, "reply-target");
		this.#syncMessagesFromWindow();
		const draft = navigationMemory.getDetailSession(
			this.conversationId,
			this.accountSession,
		);
		navigationMemory.updateDraft(
			this.conversationId,
			{ text: draft.draftText, replyTargetMessageId: message.messageId },
			this.accountSession,
		);
	}

	clearReplyTarget(): void {
		if (this.replyTarget)
			this.#messageWindow.unpin(this.replyTarget.messageId, "reply-target");
		this.replyTarget = null;
		this.#syncMessagesFromWindow();
		const draft = navigationMemory.getDetailSession(
			this.conversationId,
			this.accountSession,
		);
		navigationMemory.updateDraft(
			this.conversationId,
			{ text: draft.draftText, replyTargetMessageId: null },
			this.accountSession,
		);
	}

	send(message: MessageType): Promise<SendOwnershipTransfer> {
		if (!this.profile)
			return Promise.reject(new Error("Conversation is not ready"));
		const replyTarget = this.replyTarget;
		const accepted = this.#enqueue(message, replyTarget);
		if (replyTarget)
			this.#messageWindow.unpin(replyTarget.messageId, "reply-target");
		this.replyTarget = null;
		this.#syncMessagesFromWindow();
		navigationMemory.clearDraft(this.conversationId, this.accountSession);
		return Promise.resolve(accepted);
	}

	sendAgain(messageId: string): void {
		if (!this.profile) return;
		const original = this.messages.find(
			(message) => message.messageId === messageId,
		);
		if (
			!original ||
			(original.status !== "confirming" &&
				original.status !== "failed" &&
				original.status !== "handled")
		)
			return;
		const message = { type: original.type, body: original.body } as MessageType;
		original.status = "handled";
		this.#enqueue(message, original.replyToMessage);
	}

	#enqueue(
		message: MessageType,
		replyTarget: ApiResponseMessage["replyToMessage"],
	): SendOwnershipTransfer {
		const tempId = `pending-${crypto.randomUUID()}`;
		const attemptRef = crypto.randomUUID();
		const outerCommandRef = crypto.randomUUID();
		const optimistic: OptimisticMessage = {
			...message,
			messageId: tempId,
			conversationId: this.conversationId,
			senderId: this.ourProfileId,
			timestamp: Date.now(),
			unsent: false,
			reactions: [],
			refValue: attemptRef ?? null,
			replyToMessage: replyTarget ? stripNestedReply(replyTarget) : null,
			status: "queued" as const,
			attemptRef,
			outerCommandRef,
			retryCount: 0,
		};
		this.#messageWindow.pin(optimistic, "optimistic");
		this.#syncMessagesFromWindow();
		this.#updatePreview(optimistic);
		this.#syncCache();
		void this.#resolveMessage({
			tempId,
			message,
			replyToMessageId: replyTarget?.messageId,
			attemptRef,
			outerCommandRef,
		});
		return { kind: "accepted", operationId: tempId };
	}

	#restoreReplyTargetFromMemory(): void {
		const draft = navigationMemory.getDetailSession(
			this.conversationId,
			this.accountSession,
		);
		if (draft.replyTargetMessageId === null) {
			this.replyTarget = null;
			return;
		}
		const target =
			this.messages.find(
				(message) =>
					message.messageId === draft.replyTargetMessageId &&
					message.conversationId === this.conversationId,
			) ?? null;
		this.replyTarget = target;
		if (target) this.#messageWindow.pin(target, "reply-target");
		if (target === null) {
			navigationMemory.updateDraft(
				this.conversationId,
				{ text: draft.draftText, replyTargetMessageId: null },
				this.accountSession,
			);
		}
	}

	async #resolveMessage({
		tempId,
		message,
		replyToMessageId,
		attemptRef,
		outerCommandRef,
	}: {
		tempId: string;
		message: MessageType;
		replyToMessageId?: string;
		attemptRef: string;
		outerCommandRef: string;
	}): Promise<void> {
		if (!this.#isCurrentOwner()) return;
		const pending = this.messages.find((m) => m.messageId === tempId);
		if (pending && pending.status !== "sent") pending.status = "awaitingAck";
		this.#syncCache();
		try {
			const outcome = await getDirectMessageSession({
				accountProfileId: this.ourProfileId,
				conversationId: this.conversationId,
				toUserId: this.profile!.profileId,
			}).send({
				message,
				attemptRef,
				commandRef: outerCommandRef,
				...(replyToMessageId ? { replyToMessageId } : {}),
			});
			if (!this.#isCurrentOwner()) return;
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg && msg.status !== "sent") {
				if (outcome.kind === "ack") {
					msg.status = "sent";
					this.#messageWindow.confirmOptimistic(tempId, msg);
					this.#syncMessagesFromWindow();
				} else if (outcome.kind === "unknown") msg.status = "confirming";
				else {
					msg.status = "failed";
					msg.lastAttemptAt = Date.now();
				}
			}
			this.#syncCache();
			void this.#conversations.ensureLoaded(this.conversationId);
		} catch {
			if (!this.#isCurrentOwner()) return;
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg && msg.status !== "sent") {
				msg.status = "failed";
				msg.lastAttemptAt = Date.now();
			}
			const latestSent = this.messages.find((m) => m.status === "sent");
			this.#updatePreview(latestSent);
			this.#syncCache();
		}
	}

	markFailedMessageHandled(messageId: string): void {
		const message = this.messages.find((item) => item.messageId === messageId);
		if (!message || message.status !== "failed") return;
		message.status = "handled";
		this.#syncCache();
	}

	async retryFailedMessage(messageId: string): Promise<void> {
		if (!this.#isCurrentOwner()) return;
		const message = this.messages.find((item) => item.messageId === messageId);
		if (
			!message ||
			(message.status !== "failed" && message.status !== "handled")
		)
			return;
		if ((message.retryCount ?? 0) >= 1) return;
		if (this.#retryingMessageIds.has(messageId)) return;
		this.#retryingMessageIds.add(messageId);
		try {
			const previousAttemptAt = message.lastAttemptAt ?? message.timestamp;
			const duplicateWindowMs =
				getDeveloperSettingsSnapshot().messageDuplicateReconcileWindowMs;
			try {
				const latest = await getConversation({
					conversationId: this.conversationId,
				});
				if (!this.#isCurrentOwner()) return;
				const duplicate = latest.messages.find(
					(candidate) =>
						candidate.senderId === this.ourProfileId &&
						sameLegacyMessage(candidate, message) &&
						candidate.timestamp >= previousAttemptAt - duplicateWindowMs &&
						candidate.timestamp <= Date.now() + duplicateWindowMs,
				);
				if (duplicate) {
					const previousId = message.messageId;
					Object.assign(message, duplicate, { status: "sent" as const });
					this.#messageWindow.confirmOptimistic(previousId, message);
					this.#syncMessagesFromWindow();
					this.#syncCache();
					return;
				}
			} catch (error) {
				console.warn("Failed to reconcile before retrying message");
				showErrorToast({ label: "Failed to retry message", error });
				return;
			}
			if (
				(message.status !== "failed" && message.status !== "handled") ||
				(message.retryCount ?? 0) >= 1
			)
				return;
			const {
				status: _status,
				lastAttemptAt: _lastAttemptAt,
				messageId: _messageId,
				conversationId: _conversationId,
				senderId: _senderId,
				timestamp: _timestamp,
				unsent: _unsent,
				reactions: _reactions,
				refValue: _refValue,
				replyToMessage,
				attemptRef: _attemptRef,
				outerCommandRef: _outerCommandRef,
				retryCount: _retryCount,
				...payload
			} = message;
			void [
				_status,
				_lastAttemptAt,
				_messageId,
				_conversationId,
				_senderId,
				_timestamp,
				_unsent,
				_reactions,
				_refValue,
				_attemptRef,
				_outerCommandRef,
				_retryCount,
			];
			const attemptRef = crypto.randomUUID();
			const outerCommandRef = crypto.randomUUID();
			message.status = "queued";
			message.lastAttemptAt = Date.now();
			message.refValue = attemptRef;
			message.attemptRef = attemptRef;
			message.outerCommandRef = outerCommandRef;
			message.retryCount = 1;
			this.#syncCache();
			void this.#resolveMessage({
				tempId: message.messageId,
				message: payload as MessageType,
				replyToMessageId: replyToMessage?.messageId,
				attemptRef,
				outerCommandRef,
			});
		} finally {
			this.#retryingMessageIds.delete(messageId);
		}
	}

	// Echoes come back in send order, so match the oldest pending; prefer a
	// same-type match when kinds arrive out of order.
	#matchPendingEcho(
		incoming: ApiResponseMessage,
	): OptimisticMessage | undefined {
		if (incoming.refValue) {
			const correlated = this.messages.find(
				(candidate) => candidate.refValue === incoming.refValue,
			);
			if (correlated) return correlated;
		}
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const candidate = this.messages[i];
			if (candidate.status === "sent") continue;
			if (sameLegacyMessage(incoming, candidate)) return candidate;
		}
		return undefined;
	}

	#advanceLastRead(timestamp: number | null): boolean {
		if (timestamp === null) return false;
		if (this.lastReadTimestamp !== null && timestamp <= this.lastReadTimestamp)
			return false;
		this.lastReadTimestamp = timestamp;
		return true;
	}

	#syncCache(): void {
		if (!this.profile || !this.#isCurrentOwner()) return;
		const cachedMessages: ApiResponseMessage[] = this.messages
			.filter((m) => m.status === "sent")
			.map(({ status: _status, ...rest }) => {
				void _status;
				return rest;
			});
		const failedMessages = this.messages.flatMap(
			({
				status,
				lastAttemptAt,
				attemptRef,
				outerCommandRef,
				retryCount,
				...message
			}) => {
				if (status === "sent") return [];
				return [
					{
						localId: message.messageId,
						message,
						state: status,
						lastAttemptAt: lastAttemptAt ?? message.timestamp,
						attemptRef,
						outerCommandRef,
						retryCount: retryCount ?? 0,
					},
				];
			},
		);
		this.#conversations.setCachedConversation(this.conversationId, {
			messages: cachedMessages,
			failedMessages,
			profile: this.profile,
			pageKey: this.pageKey,
			lastReadTimestamp: this.lastReadTimestamp,
			segments: this.#messageWindow.segmentMetadata,
			removedMessageIds: [...this.#removedMessageIds],
		});
	}

	#hydrateMessageWindow({
		messages,
		pageKey,
		segments,
	}: {
		messages: OptimisticMessage[];
		pageKey: string | null;
		segments?: readonly {
			segmentId: string;
			cursor: string | null;
			nextCursor: string | null;
			messageIds: readonly string[];
		}[];
	}): void {
		this.#messageWindow.clear();
		if (!segments || segments.length === 0) {
			this.#messageWindow.addOlderPage({
				cursor: null,
				nextCursor: pageKey,
				messages,
			});
			return;
		}
		const byId = new Map(
			messages.map((message) => [message.messageId, message] as const),
		);
		const assigned = new Set<string>();
		for (const segment of segments) {
			const page = segment.messageIds.flatMap((messageId) => {
				const message = byId.get(messageId);
				if (!message) return [];
				assigned.add(messageId);
				return [message];
			});
			this.#messageWindow.hydrateSegment(
				{
					segmentId: segment.segmentId,
					cursor: segment.cursor,
					nextCursor: segment.nextCursor,
					messageIds: [...segment.messageIds],
				},
				page,
			);
		}
		const unassigned = messages.filter(
			(message) => !assigned.has(message.messageId),
		);
		for (const message of unassigned) this.#messageWindow.upsertNewest(message);
	}

	#syncMessagesFromWindow(): void {
		this.messages = removeDuplicateMessages(this.#messageWindow.messages);
		this.voiceNotes.merge(this.messages);
		// Svelte wraps assigned records in deep reactive proxies. Adopt those
		// proxies so later in-place status/reaction updates remain canonical in
		// the segmented window instead of being replaced by stale raw objects.
		this.#messageWindow.reconcileActive(this.messages);
		this.newerSegmentId =
			this.#messageWindow.getAdjacentNewerSegment()?.segmentId ?? null;
	}

	async #restoreKnownSegment(segmentId: string): Promise<boolean> {
		if (!this.#isCurrentOwner()) return false;
		const metadata = this.#messageWindow.getSegmentMetadata(segmentId);
		if (!metadata) return false;
		const expectedIds = new Set(metadata.messageIds);
		const cached = await this.#conversations.getCachedConversation(
			this.conversationId,
		);
		if (!this.#isCurrentOwner()) return false;
		if (cached) {
			const cachedPage = cached.messages.filter((message) =>
				expectedIds.has(message.messageId),
			);
			if (
				new Set(cachedPage.map((message) => message.messageId)).size ===
				expectedIds.size
			) {
				const restored = this.#messageWindow.restoreSegment(
					segmentId,
					cachedPage.map((message) => ({
						...message,
						status: "sent" as const,
					})),
				);
				if (restored) {
					this.#syncMessagesFromWindow();
					this.#syncCache();
					return true;
				}
			}
		}

		const result = await getConversation({
			conversationId: this.conversationId,
			...(metadata.cursor === null ? {} : { pageKey: metadata.cursor }),
		});
		if (!this.#isCurrentOwner()) return false;
		const restored = this.#messageWindow.restoreSegment(
			segmentId,
			result.messages.map((message) => ({
				...message,
				status: "sent" as const,
			})),
		);
		if (!restored) return false;
		this.#syncMessagesFromWindow();
		this.#advanceLastRead(result.lastReadTimestamp);
		this.#syncCache();
		return true;
	}

	#updatePreview(
		message: DisplayMessage | undefined,
		timestamp = message?.timestamp,
	) {
		this.#conversations.updatePreview({
			conversationId: this.conversationId,
			preview: previewFromMessage(message),
			timestamp: timestamp ?? -1,
		});
	}

	#updatePreviewFromMessages(): void {
		const latest = this.messages.at(0);
		if (latest?.type === "Retract") {
			const target = this.messages.find(
				(message) => message.messageId === latest.body.targetMessageId,
			);
			this.#updatePreview(
				getShowRetractedMessagesSnapshot() && target ? target : latest,
				latest.timestamp,
			);
			return;
		}
		const visible = applyMessageRetractions(
			this.messages,
			getShowRetractedMessagesSnapshot(),
		);
		this.#updatePreview(visible.at(0));
	}

	remove(messageId: string) {
		const isLatest = this.messages.at(0)?.messageId === messageId;

		let revert = () => {};
		const index = this.messages.findIndex((m) => m.messageId === messageId);
		if (index > -1) {
			const removed = this.#messageWindow.remove(messageId);
			if (!removed) return { revert };
			this.#removedMessageIds.add(messageId);
			this.#syncMessagesFromWindow();
			this.#conversations.removeMessageFromSearch(
				this.conversationId,
				messageId,
			);
			if (isLatest) this.#updatePreview(this.messages.at(0));
			this.#syncCache();
			const revertDeleteMessage = () => {
				this.#removedMessageIds.delete(messageId);
				this.#messageWindow.reconcileActive([...this.messages, removed]);
				this.#syncMessagesFromWindow();
				if (isLatest) this.#updatePreview(removed);
				this.#syncCache();
			};

			const isOnly = this.messages.length === 0;
			let revertDeleteConversation = () => {};
			if (isOnly) {
				({ revert: revertDeleteConversation } = this.#conversations.remove(
					this.conversationId,
				));
			}

			revert = () => {
				revertDeleteConversation();
				revertDeleteMessage();
			};
		}

		return {
			revert,
		};
	}

	reportRead({
		messageId,
		timestamp,
	}: {
		messageId: string;
		timestamp: number;
	}): void {
		if (!this.#isCurrentOwner()) return;
		if (this.lastReadTimestamp !== null && timestamp <= this.lastReadTimestamp)
			return;
		this.#readQueue.push({ messageId, timestamp });
		const current = now();
		this.#readDeadline ??= current + READ_MAX_WAIT_MS;
		if (this.#readTimer !== null) clearTimeout(this.#readTimer);
		const delay = Math.max(
			0,
			Math.min(READ_DEBOUNCE_MS, this.#readDeadline - current),
		);
		this.#readTimer = setTimeout(() => {
			void this.#flushReadQueue();
		}, delay);
	}

	async #flushReadQueue(): Promise<void> {
		const queue = this.#readQueue;
		this.#readQueue = [];
		this.#readTimer = null;
		this.#readDeadline = null;
		if (queue.length === 0) return;
		queue.sort((a, b) => a.timestamp - b.timestamp);
		const highest = queue[queue.length - 1];
		const { revealMessageRead } = await getPreferences();
		if (!isAccountSessionCurrent(this.accountSession)) return;
		const revertLocalRead = this.#conversations.markReadLocally(
			this.conversationId,
		);
		if (revealMessageRead) {
			try {
				await markConversationAsRead({
					conversationId: this.conversationId,
					messageId: highest.messageId,
				});
			} catch (error) {
				revertLocalRead();
				console.error(error);
				showErrorToast({
					label: "Failed to mark conversation as read",
					error,
				});
			}
		}
	}

	async reactTo(messageId: string, reactionType: number): Promise<void> {
		const msg = this.messages.find((m) => m.messageId === messageId);
		if (!msg) return;
		const optimistic = { reactionType, profileId: this.ourProfileId };
		msg.reactions.push(optimistic);
		this.#syncCache();
		try {
			await reactToMessage({
				conversationId: this.conversationId,
				messageId,
				reactionType,
			});
		} catch (err) {
			const idx = msg.reactions.findIndex((r) => r === optimistic);
			if (idx !== -1) msg.reactions.splice(idx, 1);
			this.#syncCache();
			throw err;
		}
	}

	markMessageAsUnsent(messageId: string) {
		const msg = this.messages.find((m) => m.messageId === messageId);
		let revert: () => void = () => {};
		if (msg) {
			const original = {
				unsent: msg.unsent,
				type: msg.type,
				body: msg.body,
			};
			msg.unsent = true;
			msg.type = "Unsent";
			msg.body = null;
			this.#syncCache();
			this.#updatePreview(msg);
			revert = () => {
				msg.unsent = original.unsent;
				msg.type = original.type;
				msg.body = original.body;
				this.#syncCache();
				this.#updatePreview(msg);
			};
		}
		return {
			revert,
		};
	}
}

function removeDuplicateMessages(
	messages: OptimisticMessage[],
): OptimisticMessage[] {
	const ids = new Set<string>();
	return messages
		.filter((m) => {
			if (ids.has(m.messageId)) return false;
			ids.add(m.messageId);
			return true;
		})
		.toSorted((a, b) => b.timestamp - a.timestamp);
}

export const [getConversationState, setConversationState] =
	createContext<() => ConversationState>();
