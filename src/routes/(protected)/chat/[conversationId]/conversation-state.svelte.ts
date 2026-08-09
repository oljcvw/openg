import { createContext } from "svelte";

import { ApiError } from "$lib/api";
import { showErrorToast } from "$lib/api/error";
import { markConversationAsRead } from "$lib/api/messaging/conversations";
import {
	reactToMessage,
	sendMessage,
	sendReplyMessage,
} from "$lib/api/messaging/messages";
import {
	getDeveloperSettingsSnapshot,
	getPreferences,
	getShowRetractedMessagesSnapshot,
	subscribePreferences,
} from "$lib/app-data/preferences.svelte";
import {
	applyMessageRetractions,
	previewFromMessage,
} from "$lib/model/messaging/messages";
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
	refreshing = $state(false);
	error: Error | null = $state(null);
	lastReadTimestamp: number | null = $state(null);
	replyTarget: ApiResponseMessage | null = $state(null);

	readonly conversationId: string;
	readonly ourProfileId: number;
	readonly hasSharedAlbumsHint: boolean | null;

	#conversations: ConversationsState;
	#readQueue: { messageId: string; timestamp: number }[] = [];
	#readTimer: ReturnType<typeof setTimeout> | null = null;
	#readDeadline: number | null = null;
	#unsubscribeReconcile: () => void;
	#unsubscribePreferences: () => void;
	#retryingMessageIds = new Set<string>();

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
				if (this.#destroyed) return;
				const incoming = event.payload;
				if (incoming.conversationId !== this.conversationId) return;

				const existing = this.messages.find(
					(m) => m.messageId === incoming.messageId,
				);
				if (existing) {
					Object.assign(existing, incoming, { status: "sent" as const });
					this.#syncCache();
					return;
				}

				if (incoming.senderId === this.ourProfileId) {
					const pending = this.#matchPendingEcho(incoming);
					if (pending) {
						pending.status = "sent";
						pending.messageId = incoming.messageId;
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
				this.messages = [msg, ...this.messages];
				this.#syncCache();
				if (msg.senderId !== this.ourProfileId) {
					void this.reportRead({
						messageId: msg.messageId,
						timestamp: msg.timestamp,
					});
				}
			}),
			ws.on(
				"chat.v1.conversation_read",
				chatV1ConversationReadEventSchema,
				(event) => {
					if (this.#destroyed) return;
					if (event.payload.conversationId !== this.conversationId) return;
					if (event.payload.profileId === this.ourProfileId) return;
					if (this.#advanceLastRead(event.payload.timestamp)) this.#syncCache();
				},
			),
			ws.on(
				"chat.v1.conversation.delete",
				chatV1ConversationDeleteEventSchema,
				(event) => {
					if (this.#destroyed) return;
					if (!event.payload.conversationIds.includes(this.conversationId))
						return;
					void this.#reconcileMessages();
				},
			),
		);
	}

	#wsPromises: Promise<() => void>[] = [];

	#destroyed = false;
	get destroyed(): boolean {
		return this.#destroyed;
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
		if (this.#readTimer !== null) clearTimeout(this.#readTimer);
		if (this.#readQueue.length > 0) void this.#flushReadQueue();
	}

	async #reconcileMessages(): Promise<void> {
		if (this.loading || this.#destroyed || this.refreshing) return;
		this.refreshing = true;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			if (this.#destroyed) return;

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
						claimedServerIds.add(serverVersion.messageId);
						seenLocalIds.add(serverVersion.messageId);
						newValue.push({ ...serverVersion, status: "sent" as const });
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

			this.messages = removeDuplicateMessages(newValue);
			this.#updatePreview(this.messages.at(0));
			this.#syncCache();

			for (const m of fresh) {
				if (m.senderId === this.ourProfileId) continue;
				void this.reportRead({
					messageId: m.messageId,
					timestamp: m.timestamp,
				});
			}
		} catch (error) {
			if (this.#destroyed) return;
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
		if (this.#destroyed) return;
		void this.#initialLoad();
	}

	async #initialLoad(): Promise<void> {
		const cached = await this.#conversations.getCachedConversation(
			this.conversationId,
		);
		if (cached) {
			this.messages = removeDuplicateMessages([
				...(cached.failedMessages ?? []).map(
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
				),
				...cached.messages.map((m) => ({ ...m, status: "sent" as const })),
			]);
			this.profile = cached.profile;
			this.pageKey = cached.pageKey;
			this.lastReadTimestamp = cached.lastReadTimestamp;
			this.loading = false;
			void this.#conversations.markRead(this.conversationId);
			void this.#reconcileMessages();
			return;
		}
		this.loading = true;
		this.error = null;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
			});
			void this.#conversations.markRead(this.conversationId);
			if (this.#destroyed) return;
			this.messages = removeDuplicateMessages(
				result.messages.map((m) => ({
					...m,
					status: "sent" as const,
				})),
			);
			this.profile = result.profile;
			this.pageKey = result.pageKey;
			this.#updatePreview(this.messages.at(0));
			this.#advanceLastRead(result.lastReadTimestamp);
			this.#syncCache();
		} catch (err) {
			if (this.#destroyed) return;
			this.error = err instanceof Error ? err : new Error(String(err));
		} finally {
			this.loading = false;
		}
	}

	async loadMore(): Promise<"loaded" | "end" | "busy" | "error"> {
		if (this.loadingMore) return "busy";
		if (this.pageKey === null) return "end";
		this.loadingMore = true;
		try {
			const result = await getConversation({
				conversationId: this.conversationId,
				pageKey: this.pageKey,
			});
			if (this.#destroyed) return "error";
			this.messages = removeDuplicateMessages([
				...this.messages,
				...result.messages.map((m) => ({ ...m, status: "sent" as const })),
			]);
			this.pageKey = result.pageKey;
			this.#advanceLastRead(result.lastReadTimestamp);
			this.#syncCache();
			return "loaded";
		} catch (error) {
			if (this.#destroyed) return "error";
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

	setReplyTarget(message: ApiResponseMessage): void {
		this.replyTarget = message;
	}

	clearReplyTarget(): void {
		this.replyTarget = null;
	}

	send(message: MessageType): void {
		if (!this.profile) return;
		this.#enqueue(message, this.replyTarget);
		this.replyTarget = null;
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
	): void {
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
		this.messages = removeDuplicateMessages([optimistic, ...this.messages]);
		this.#updatePreview(optimistic);
		void this.#resolveMessage({
			tempId,
			message,
			replyToMessageId: replyTarget?.messageId,
			attemptRef,
			outerCommandRef,
		});
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
		const pending = this.messages.find((m) => m.messageId === tempId);
		if (pending && pending.status !== "sent") pending.status = "awaitingAck";
		this.#syncCache();
		try {
			const outcome = replyToMessageId
				? await sendReplyMessage({
						toUserId: this.profile!.profileId,
						message,
						replyToMessageId,
						ref: attemptRef,
						commandRef: outerCommandRef,
					})
				: await sendMessage({
						toUserId: this.profile!.profileId,
						message,
						ref: attemptRef,
						commandRef: outerCommandRef,
					});
			const msg = this.messages.find((m) => m.messageId === tempId);
			if (msg && msg.status !== "sent") {
				if (outcome.kind === "ack") msg.status = "sent";
				else if (outcome.kind === "unknown") msg.status = "confirming";
				else {
					msg.status = "failed";
					msg.lastAttemptAt = Date.now();
				}
			}
			this.#syncCache();
			void this.#conversations.ensureLoaded(this.conversationId);
		} catch {
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
				const duplicate = latest.messages.find(
					(candidate) =>
						candidate.senderId === this.ourProfileId &&
						sameLegacyMessage(candidate, message) &&
						candidate.timestamp >= previousAttemptAt - duplicateWindowMs &&
						candidate.timestamp <= Date.now() + duplicateWindowMs,
				);
				if (duplicate) {
					Object.assign(message, duplicate, { status: "sent" as const });
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
		if (!this.profile) return;
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
		});
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
			const [removed] = this.messages.splice(index, 1);
			this.#conversations.removeMessageFromSearch(
				this.conversationId,
				messageId,
			);
			if (isLatest) this.#updatePreview(this.messages.at(0));
			this.#syncCache();
			const revertDeleteMessage = () => {
				this.messages.splice(index, 0, removed);
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
		if (revealMessageRead) {
			try {
				await markConversationAsRead({
					conversationId: this.conversationId,
					messageId: highest.messageId,
				});
			} catch (error) {
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
