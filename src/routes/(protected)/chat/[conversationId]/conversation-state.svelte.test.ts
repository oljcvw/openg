import { beforeEach, describe, expect, it, vi } from "vitest";

// Send transfers ownership synchronously; these tests intentionally inspect the
// optimistic operation while its separate transport promise remains pending.
/* eslint-disable @typescript-eslint/no-floating-promises */

const {
	getConversationMock,
	markReadMock,
	markConversationAsReadMock,
	sendMessageMock,
	sendReplyMessageMock,
	readHandlers,
	messageSentHandlers,
	reconcileHandlers,
	showErrorToastMock,
	developerSettings,
} = vi.hoisted(() => ({
	getConversationMock: vi.fn(),
	markReadMock: vi.fn(),
	markConversationAsReadMock: vi.fn(() => Promise.resolve()),
	sendMessageMock: vi.fn(),
	sendReplyMessageMock: vi.fn(),
	readHandlers: [] as ((event: unknown) => void)[],
	messageSentHandlers: [] as ((event: unknown) => void)[],
	reconcileHandlers: [] as (() => void | Promise<void>)[],
	showErrorToastMock: vi.fn(),
	developerSettings: { messageDuplicateReconcileWindowMs: 5_000 },
}));

vi.mock("$lib/api/error", () => ({ showErrorToast: showErrorToastMock }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getPreferences: () => Promise.resolve({ revealMessageRead: true }),
	getDeveloperSettingsSnapshot: () => developerSettings,
	getShowRetractedMessagesSnapshot: () => false,
	subscribePreferences: () => vi.fn(),
}));
vi.mock("$lib/api/messaging/conversations", () => ({
	markConversationAsRead: markConversationAsReadMock,
}));
vi.mock("$lib/api/messaging/messages", () => ({
	reactToMessage: vi.fn(),
	sendMessage: sendMessageMock,
	sendReplyMessage: sendReplyMessageMock,
}));
vi.mock("$lib/util/reconcile", () => ({
	reconciler: {
		subscribe(_scope: string, handler: () => void | Promise<void>) {
			reconcileHandlers.push(handler);
			return vi.fn();
		},
	},
}));
vi.mock("./messages", () => ({ getConversation: getConversationMock }));
vi.mock("$lib/ws.svelte", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/ws.svelte")>()),
	ws: {
		on(eventType: string, _schema: unknown, handler: (e: unknown) => void) {
			if (eventType === "chat.v1.conversation_read") readHandlers.push(handler);
			if (eventType === "chat.v1.message_sent")
				messageSentHandlers.push(handler);
			return Promise.resolve(vi.fn());
		},
	},
}));

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import { navigationMemory } from "$lib/navigation/navigation-memory";
import type { Message } from "$lib/model/messaging/messages";
import { ConversationState } from "./conversation-state.svelte";

const CONVERSATION_ID = "1:2";
const OUR_ID = 1;
const PEER_ID = 2;

const message = (messageId: string, timestamp: number) => ({
	messageId,
	conversationId: CONVERSATION_ID,
	senderId: OUR_ID,
	timestamp,
	unsent: false,
	reactions: [],
	type: "Text" as const,
	body: { text: messageId },
});

const profile = {
	distance: null,
	mediaHash: null,
	name: "Peer",
	onlineUntil: null,
	profileId: PEER_ID,
	showDistance: false,
};

function conversationsStub() {
	return {
		setActive: vi.fn(),
		clearActive: vi.fn(),
		sharedAlbumsHint: vi.fn(() => null),
		getCachedConversation: vi.fn((): Promise<unknown> => Promise.resolve()),
		setCachedConversation: vi.fn(),
		removeMessageFromSearch: vi.fn(),
		updatePreview: vi.fn(),
		markRead: markReadMock,
		ensureLoaded: vi.fn(),
	};
}

function create(conversations = conversationsStub()) {
	return new ConversationState({
		conversationId: CONVERSATION_ID,
		ourProfileId: OUR_ID,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		conversations: conversations as any,
	});
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function emitMessageSent(payload: unknown) {
	messageSentHandlers[0]?.({ payload });
}

function outbound(type: string, body: unknown): Message {
	return { type, body } as unknown as Message;
}

function echo(messageId: string, type: string, body: unknown) {
	return {
		messageId,
		conversationId: CONVERSATION_ID,
		senderId: OUR_ID,
		timestamp: 5000,
		unsent: false,
		reactions: [],
		type,
		body,
	};
}

describe("ConversationState read marker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
	});

	it("does not let a reconcile with no message deltas roll the marker backwards", async () => {
		const messages = [message("m2", 2000), message("m1", 1000)];
		getConversationMock.mockResolvedValue({
			messages,
			profile,
			pageKey: null,
			lastReadTimestamp: 1000,
		});

		const state = create();
		await flush();
		expect(state.lastReadTimestamp).toBe(1000);

		readHandlers[0]?.({
			payload: {
				conversationId: CONVERSATION_ID,
				profileId: PEER_ID,
				timestamp: 2000,
			},
		});
		expect(state.lastReadTimestamp).toBe(2000);

		await reconcileHandlers[0]?.();
		await flush();

		expect(state.lastReadTimestamp).toBe(2000);
	});

	it("still advances the marker forward on reconcile", async () => {
		const messages = [message("m2", 2000), message("m1", 1000)];
		getConversationMock.mockResolvedValue({
			messages,
			profile,
			pageKey: null,
			lastReadTimestamp: 1000,
		});

		const state = create();
		await flush();
		expect(state.lastReadTimestamp).toBe(1000);

		getConversationMock.mockResolvedValue({
			messages,
			profile,
			pageKey: null,
			lastReadTimestamp: 2000,
		});
		await reconcileHandlers[0]?.();
		await flush();

		expect(state.lastReadTimestamp).toBe(2000);
	});

	it("keeps the marker when a paged fetch carries no read timestamp", async () => {
		getConversationMock.mockResolvedValue({
			messages: [message("m2", 2000), message("m1", 1000)],
			profile,
			pageKey: "page-2",
			lastReadTimestamp: 2000,
		});

		const state = create();
		await flush();
		expect(state.lastReadTimestamp).toBe(2000);

		getConversationMock.mockResolvedValue({
			messages: [message("m0", 500)],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.loadMore();
		await flush();

		expect(state.lastReadTimestamp).toBe(2000);
	});
});

describe("ConversationState send echo matching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
		sendMessageMock.mockReturnValue(new Promise(() => {}));
	});

	it("resolves concurrent send echoes FIFO, not to the newest pending", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});

		const state = create();
		await flush();

		state.send(outbound("Text", { text: "a" }));
		state.send(outbound("Text", { text: "b" }));

		const bodyText = (m: { body: unknown }) =>
			(m.body as { text: string }).text;
		expect(state.messages.map(bodyText)).toEqual(["b", "a"]);
		expect(state.messages.every((m) => m.status === "awaitingAck")).toBe(true);

		emitMessageSent(echo("real-a", "Text", { text: "a" }));

		const a = state.messages.find((m) => bodyText(m) === "a")!;
		const b = state.messages.find((m) => bodyText(m) === "b")!;
		expect(a.messageId).toBe("real-a");
		expect(a.status).toBe("sent");
		expect(b.status).toBe("awaitingAck");
		expect(b.messageId).not.toBe("real-a");

		emitMessageSent(echo("real-b", "Text", { text: "b" }));
		expect(b.messageId).toBe("real-b");
		expect(b.status).toBe("sent");
	});

	it("resolves accepted ownership only after the optimistic operation is cached", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const conversations = conversationsStub();
		const state = create(conversations);
		await flush();

		const accepted = await state.send(outbound("Text", { text: "owned" }));

		expect(accepted).toEqual({
			kind: "accepted",
			operationId: expect.stringMatching(/^pending-/),
		});
		expect(state.messages[0].messageId).toBe(accepted.operationId);
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].failedMessages[0],
		).toMatchObject({
			localId: accepted.operationId,
			state: "awaitingAck",
		});
	});

	it("matches an echo by message type when echoes arrive out of send order", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});

		const state = create();
		await flush();

		state.send(outbound("Image", { mediaId: 5 }));
		state.send(outbound("Text", { text: "hello" }));

		const text = () => state.messages.find((m) => m.type === "Text")!;
		const image = () => state.messages.find((m) => m.type === "Image")!;
		expect(text().status).toBe("awaitingAck");
		expect(image().status).toBe("awaitingAck");

		emitMessageSent(echo("real-img", "Image", { mediaId: 5 }));
		expect(image().messageId).toBe("real-img");
		expect(image().status).toBe("sent");
		expect(text().status).toBe("awaitingAck");

		emitMessageSent(echo("real-text", "Text", { text: "hello" }));
		expect(text().messageId).toBe("real-text");
		expect(text().status).toBe("sent");
	});

	it("persists all delivery identities and confirming state for an ambiguous ordinary send", async () => {
		sendMessageMock.mockResolvedValue({
			kind: "unknown",
			reason: "ambiguousResponse",
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const conversations = conversationsStub();
		const state = create(conversations);
		await flush();

		state.send(outbound("Text", { text: "ordinary" }));
		await flush();

		const pending = state.messages[0];
		expect(pending).toMatchObject({
			status: "confirming",
			refValue: expect.any(String),
			attemptRef: expect.any(String),
			outerCommandRef: expect.any(String),
		});
		expect(pending.refValue).toBe(pending.attemptRef);
		expect(sendMessageMock).toHaveBeenCalledWith({
			toUserId: PEER_ID,
			message: outbound("Text", { text: "ordinary" }),
			ref: pending.attemptRef,
			commandRef: pending.outerCommandRef,
		});
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].failedMessages[0],
		).toMatchObject({
			state: "confirming",
			attemptRef: pending.attemptRef,
			outerCommandRef: pending.outerCommandRef,
		});
	});

	it("lets an exact event heal an ambiguous ordinary send and ignores its late outcome", async () => {
		let finish!: (outcome: { kind: "unknown"; reason: "timeout" }) => void;
		sendMessageMock.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.send(outbound("Text", { text: "ordinary" }));
		await flush();
		const attemptRef = state.messages[0].attemptRef!;

		emitMessageSent({
			...echo("server-ordinary", "Text", { text: "ordinary" }),
			refValue: attemptRef,
		});
		finish({ kind: "unknown", reason: "timeout" });
		await flush();

		expect(state.messages[0]).toMatchObject({
			messageId: "server-ordinary",
			status: "sent",
			refValue: attemptRef,
		});
	});

	it("heals an ambiguous ordinary send from history by exact attempt reference", async () => {
		sendMessageMock.mockResolvedValue({
			kind: "unknown",
			reason: "timeout",
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const conversations = conversationsStub();
		const state = create(conversations);
		await flush();

		state.send(outbound("Text", { text: "history ordinary" }));
		await flush();
		const attemptRef = state.messages[0].attemptRef!;
		expect(state.messages[0].status).toBe("confirming");

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("server-history-ordinary", "Text", {
						text: "history ordinary",
					}),
					refValue: attemptRef,
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.refresh();

		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({
			messageId: "server-history-ordinary",
			status: "sent",
			refValue: attemptRef,
		});
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].failedMessages,
		).toEqual([]);
	});

	it("retries a definitively failed ordinary send once with fresh transport identities", async () => {
		sendMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.send(outbound("Text", { text: "ordinary" }));
		await flush();
		const first = sendMessageMock.mock.calls[0][0];
		expect(state.messages[0].status).toBe("failed");

		await state.retryFailedMessage(state.messages[0].messageId);
		await flush();
		const second = sendMessageMock.mock.calls[1][0];
		expect(second.ref).not.toBe(first.ref);
		expect(second.commandRef).not.toBe(first.commandRef);

		await state.retryFailedMessage(state.messages[0].messageId);
		expect(sendMessageMock).toHaveBeenCalledTimes(2);
	});
});

describe("ConversationState navigation-memory ownership", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
		invalidateAccountSession();
		sendMessageMock.mockReturnValue(new Promise(() => {}));
	});

	it("clears text and reply memory after ownership transfers to an optimistic operation", async () => {
		const session = activateAccountSession(901);
		const target = { ...message("target", 1000), senderId: PEER_ID };
		navigationMemory.updateDraft(
			CONVERSATION_ID,
			{ text: "owned text", replyTargetMessageId: target.messageId },
			session,
		);
		getConversationMock.mockResolvedValue({
			messages: [target],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		expect(state.replyTarget).toMatchObject(target);
		await expect(
			state.send(outbound("Text", { text: "owned text" })),
		).resolves.toMatchObject({ kind: "accepted" });
		expect(
			navigationMemory.getDetailSession(CONVERSATION_ID, session),
		).toMatchObject({ draftText: "", replyTargetMessageId: null });
	});

	it("retains draft memory when send throws before ownership transfer", async () => {
		const session = activateAccountSession(902);
		navigationMemory.updateDraft(
			CONVERSATION_ID,
			{ text: "not owned", replyTargetMessageId: null },
			session,
		);
		getConversationMock.mockReturnValue(new Promise(() => {}));
		const state = create();

		await expect(
			state.send(outbound("Text", { text: "not owned" })),
		).rejects.toThrow("Conversation is not ready");
		expect(
			navigationMemory.getDetailSession(CONVERSATION_ID, session).draftText,
		).toBe("not owned");
		expect(state.messages).toHaveLength(0);
	});

	it("drops an unresolved reply ID while retaining draft text", async () => {
		const session = activateAccountSession(903);
		navigationMemory.updateDraft(
			CONVERSATION_ID,
			{ text: "keep text", replyTargetMessageId: "missing-message" },
			session,
		);
		getConversationMock.mockResolvedValue({
			messages: [message("other-message", 1000)],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		expect(state.replyTarget).toBeNull();
		expect(
			navigationMemory.getDetailSession(CONVERSATION_ID, session),
		).toMatchObject({ draftText: "keep text", replyTargetMessageId: null });
	});
});

describe("ConversationState replies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
		sendReplyMessageMock.mockReturnValue(new Promise(() => {}));
	});

	it("links an optimistic reply and clears the composer target", async () => {
		const target = { ...message("target", 1000), senderId: PEER_ID };
		getConversationMock.mockResolvedValue({
			messages: [target],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget(target);
		state.send(outbound("Text", { text: "answer" }));

		const optimistic = state.messages[0];
		expect(state.replyTarget).toBeNull();
		expect(optimistic.replyToMessage).toEqual(
			expect.objectContaining({ messageId: "target" }),
		);
		expect(optimistic.replyToMessage).not.toHaveProperty("replyToMessage");
		expect(optimistic.refValue).toEqual(expect.any(String));
		expect(sendReplyMessageMock).toHaveBeenCalledWith({
			toUserId: PEER_ID,
			message: { type: "Text", body: { text: "answer" } },
			replyToMessageId: "target",
			ref: optimistic.refValue,
			commandRef: optimistic.outerCommandRef,
		});
	});

	it("moves an ambiguous reply outcome to confirming, not not-sent", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "unknown",
			reason: "timeout",
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();

		expect(state.messages[0].status).toBe("confirming");
	});

	it("send again intentionally creates a new logical reply and handles the ambiguous original", async () => {
		sendReplyMessageMock
			.mockResolvedValueOnce({ kind: "unknown", reason: "timeout" })
			.mockReturnValueOnce(new Promise(() => {}));
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();
		const original = state.messages[0];
		const firstAttemptRef = original.attemptRef;

		state.sendAgain(original.messageId);
		const duplicate = state.messages[0];
		expect(original.status).toBe("handled");
		expect(duplicate.messageId).not.toBe(original.messageId);
		expect(duplicate.replyToMessage?.messageId).toBe("target");
		expect(duplicate.attemptRef).not.toBe(firstAttemptRef);
		expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
	});

	it("lets an exact message-sent reference heal a failed reply", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();
		const attemptRef = state.messages[0].refValue!;
		expect(state.messages[0].status).toBe("failed");

		emitMessageSent({
			...echo("server-message", "Text", { text: "answer" }),
			refValue: attemptRef,
			replyToMessage: message("target", 1000),
		});

		expect(state.messages[0]).toMatchObject({
			messageId: "server-message",
			status: "sent",
		});
	});

	it("does not let a late definitive failure regress an acknowledged reply", async () => {
		let settle!: (value: unknown) => void;
		sendReplyMessageMock.mockReturnValue(
			new Promise((resolve) => {
				settle = resolve;
			}),
		);
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		const logicalMessageId = state.messages[0].messageId;
		const attemptRef = state.messages[0].refValue!;
		emitMessageSent({
			...echo(logicalMessageId, "Text", { text: "answer" }),
			refValue: attemptRef,
			replyToMessage: message("target", 1000),
		});
		settle({ kind: "notSent", error: new Error("late rejection") });
		await flush();

		expect(state.messages[0].status).toBe("sent");
	});

	it("does not let a late thrown transport error regress an event-confirmed reply", async () => {
		let reject!: (error: Error) => void;
		sendReplyMessageMock.mockReturnValue(
			new Promise((_resolve, rejectPromise) => {
				reject = rejectPromise;
			}),
		);
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		const logicalMessageId = state.messages[0].messageId;
		const attemptRef = state.messages[0].refValue!;
		emitMessageSent({
			...echo(logicalMessageId, "Text", { text: "answer" }),
			refValue: attemptRef,
			replyToMessage: message("target", 1000),
		});
		reject(new Error("late bridge failure"));
		await flush();

		expect(state.messages[0]).toMatchObject({
			messageId: logicalMessageId,
			status: "sent",
		});
	});

	it("replaces an acknowledged local reply with its exact server echo", async () => {
		sendReplyMessageMock.mockResolvedValue({ kind: "ack", payload: null });
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();
		const attemptRef = state.messages[0].refValue!;
		expect(state.messages[0].status).toBe("sent");

		emitMessageSent({
			...echo("server-message", "Text", { text: "answer" }),
			refValue: attemptRef,
			replyToMessage: message("target", 1000),
		});

		expect(state.messages).toHaveLength(1);
		expect(state.messages[0].messageId).toBe("server-message");
	});

	it("persists ambiguous delivery state and all three operation identities", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "unknown",
			reason: "timeout",
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const conversations = conversationsStub();
		const state = create(conversations);
		await flush();

		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();

		const stored =
			conversations.setCachedConversation.mock.lastCall?.[1].failedMessages[0];
		expect(stored).toMatchObject({
			localId: expect.stringMatching(/^pending-/),
			state: "confirming",
			attemptRef: expect.any(String),
			outerCommandRef: expect.any(String),
			retryCount: 0,
		});
		expect(stored.localId).not.toBe(stored.attemptRef);
		expect(stored.attemptRef).not.toBe(stored.outerCommandRef);
	});

	it("retries a definitive failure once with fresh attempt and command refs", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();
		const first = sendReplyMessageMock.mock.calls[0][0];

		await state.retryFailedMessage(state.messages[0].messageId);
		await flush();
		const second = sendReplyMessageMock.mock.calls[1][0];
		expect(second.ref).not.toBe(first.ref);
		expect(second.commandRef).not.toBe(first.commandRef);

		await state.retryFailedMessage(state.messages[0].messageId);
		expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
	});

	it("legacy retry reconciliation includes the reply target", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		const target = { ...message("target", 1000), senderId: PEER_ID };
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget(target);
		state.send(outbound("Text", { text: "same" }));
		await flush();

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("different-reply", "Text", { text: "same" }),
					timestamp: Date.now(),
					replyToMessage: message("other-target", 900),
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.retryFailedMessage(state.messages[0].messageId);
		await flush();

		expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
	});

	it("reconciles a legacy text reply only when its stable fields and reply target match", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		const target = { ...message("target", 1000), senderId: PEER_ID };
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget(target);
		state.send(outbound("Text", { text: "same" }));
		await flush();

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("server-reply", "Text", { text: "same" }),
					timestamp: Date.now(),
					replyToMessage: target,
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.retryFailedMessage(state.messages[0].messageId);

		expect(sendReplyMessageMock).toHaveBeenCalledOnce();
		expect(state.messages[0]).toMatchObject({
			messageId: "server-reply",
			status: "sent",
		});
	});

	it("heals an ambiguous legacy reply from history only with the same reply target", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "unknown",
			reason: "disconnect",
		});
		const target = { ...message("target", 1000), senderId: PEER_ID };
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget(target);
		state.send(outbound("Text", { text: "legacy history reply" }));
		await flush();

		const pending = state.messages[0];
		pending.attemptRef = undefined;
		pending.refValue = null;
		expect(pending.status).toBe("confirming");

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("server-history-reply", "Text", {
						text: "legacy history reply",
					}),
					timestamp: pending.timestamp,
					replyToMessage: target,
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.refresh();

		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]).toMatchObject({
			messageId: "server-history-reply",
			status: "sent",
			replyToMessage: expect.objectContaining({ messageId: "target" }),
		});
	});

	it("uses the configured duplicate reconciliation window", async () => {
		developerSettings.messageDuplicateReconcileWindowMs = 100;
		try {
			sendReplyMessageMock.mockResolvedValue({
				kind: "notSent",
				error: new Error("rejected"),
			});
			const target = { ...message("target", 1000), senderId: PEER_ID };
			getConversationMock.mockResolvedValue({
				messages: [],
				profile,
				pageKey: null,
				lastReadTimestamp: null,
			});
			const state = create();
			await flush();
			state.setReplyTarget(target);
			state.send(outbound("Text", { text: "same" }));
			await flush();
			const previousAttemptAt = state.messages[0].lastAttemptAt!;

			getConversationMock.mockResolvedValue({
				messages: [
					{
						...echo("outside-window", "Text", { text: "same" }),
						timestamp: previousAttemptAt - 250,
						replyToMessage: target,
					},
				],
				profile,
				pageKey: null,
				lastReadTimestamp: null,
			});
			await state.retryFailedMessage(state.messages[0].messageId);
			await flush();

			expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
		} finally {
			developerSettings.messageDuplicateReconcileWindowMs = 5_000;
		}
	});

	it("does not use structural equality to reconcile an unsupported legacy body", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		const target = { ...message("target", 1000), senderId: PEER_ID };
		state.setReplyTarget(target);
		state.send(outbound("Unknown", { sourceType: "future-message" }));
		await flush();

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("server-unknown", "Unknown", {
						sourceType: "future-message",
					}),
					timestamp: Date.now(),
					replyToMessage: target,
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.retryFailedMessage(state.messages[0].messageId);
		await flush();

		expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent retry requests before reconciliation completes", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();

		let finishReconcile!: (value: unknown) => void;
		getConversationMock.mockReturnValue(
			new Promise((resolve) => {
				finishReconcile = resolve;
			}),
		);
		const messageId = state.messages[0].messageId;
		const first = state.retryFailedMessage(messageId);
		const second = state.retryFailedMessage(messageId);
		expect(getConversationMock).toHaveBeenCalledTimes(2);

		finishReconcile({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await Promise.all([first, second]);
		await flush();

		expect(sendReplyMessageMock).toHaveBeenCalledTimes(2);
	});

	it("does not retry after an exact echo arrives during reconciliation", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget({ ...message("target", 1000), senderId: PEER_ID });
		state.send(outbound("Text", { text: "answer" }));
		await flush();
		const attemptRef = state.messages[0].refValue!;

		let finishReconcile!: (value: unknown) => void;
		getConversationMock.mockReturnValue(
			new Promise((resolve) => {
				finishReconcile = resolve;
			}),
		);
		const retry = state.retryFailedMessage(state.messages[0].messageId);
		emitMessageSent({
			...echo("server-message", "Text", { text: "answer" }),
			refValue: attemptRef,
			replyToMessage: message("target", 1000),
		});
		finishReconcile({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await retry;
		await flush();

		expect(sendReplyMessageMock).toHaveBeenCalledOnce();
		expect(state.messages[0].status).toBe("sent");
	});

	it("semantically matches legacy bodies regardless of object key order", async () => {
		sendReplyMessageMock.mockResolvedValue({
			kind: "notSent",
			error: new Error("rejected"),
		});
		const target = { ...message("target", 1000), senderId: PEER_ID };
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();
		state.setReplyTarget(target);
		state.send(outbound("Location", { lat: 53.35, lon: -6.26 }));
		await flush();

		getConversationMock.mockResolvedValue({
			messages: [
				{
					...echo("server-location", "Location", {
						lon: -6.26,
						lat: 53.35,
					}),
					timestamp: Date.now(),
					replyToMessage: target,
				},
			],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		await state.retryFailedMessage(state.messages[0].messageId);

		expect(sendReplyMessageMock).toHaveBeenCalledOnce();
		expect(state.messages[0]).toMatchObject({
			messageId: "server-location",
			status: "sent",
		});
	});
});

describe("ConversationState search-corpus synchronization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
	});

	it("removes deleted text and restores deleted or unsent text on rollback", async () => {
		getConversationMock.mockResolvedValue({
			messages: [message("needle", 2000), message("other", 1000)],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const conversations = conversationsStub();
		const state = create(conversations);
		await flush();

		const deletion = state.remove("needle");
		expect(conversations.removeMessageFromSearch).toHaveBeenCalledWith(
			CONVERSATION_ID,
			"needle",
		);
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].messages.map(
				(candidate: { messageId: string }) => candidate.messageId,
			),
		).toEqual(["other"]);

		deletion.revert();
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].messages.map(
				(candidate: { messageId: string }) => candidate.messageId,
			),
		).toEqual(["needle", "other"]);

		const unsend = state.markMessageAsUnsent("needle");
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].messages.find(
				(candidate: { messageId: string }) => candidate.messageId === "needle",
			),
		).toEqual(expect.objectContaining({ type: "Unsent", unsent: true }));

		unsend.revert();
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].messages.find(
				(candidate: { messageId: string }) => candidate.messageId === "needle",
			),
		).toEqual(
			expect.objectContaining({
				type: "Text",
				unsent: false,
				body: { text: "needle" },
			}),
		);
	});
});

describe("ConversationState read receipts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
	});

	it("debounces a burst into a single read request for the newest message", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		vi.useFakeTimers();
		try {
			state.reportRead({ messageId: "m1", timestamp: 1000 });
			state.reportRead({ messageId: "m2", timestamp: 1001 });
			await vi.advanceTimersByTimeAsync(500);

			expect(markConversationAsReadMock).toHaveBeenCalledTimes(1);
			expect(markConversationAsReadMock).toHaveBeenCalledWith({
				conversationId: CONVERSATION_ID,
				messageId: "m2",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("flushes within the max-wait even under a continuous sub-debounce stream", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		vi.useFakeTimers();
		try {
			for (let i = 0; i < 6; i++) {
				state.reportRead({ messageId: `m${i}`, timestamp: 1000 + i });
				await vi.advanceTimersByTimeAsync(400);
			}
			expect(markConversationAsReadMock).toHaveBeenCalled();
			expect(markConversationAsReadMock).toHaveBeenCalledWith({
				conversationId: CONVERSATION_ID,
				messageId: "m4",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("discards a queued read when teardown crosses an account generation", async () => {
		getConversationMock.mockResolvedValue({
			messages: [],
			profile,
			pageKey: null,
			lastReadTimestamp: null,
		});
		const state = create();
		await flush();

		state.reportRead({ messageId: "old-account-message", timestamp: 1000 });
		invalidateAccountSession();
		state.destroy();
		await flush();

		expect(markConversationAsReadMock).not.toHaveBeenCalled();
	});

	it("does not mark a conversation read after its initial cache load is destroyed", async () => {
		let resolveCached!: (value: unknown) => void;
		const cached = new Promise((resolve) => {
			resolveCached = resolve;
		});
		const conversations = conversationsStub();
		conversations.getCachedConversation.mockReturnValue(cached);
		const state = create(conversations);

		state.destroy();
		resolveCached(undefined);
		await flush();

		expect(conversations.markRead).not.toHaveBeenCalled();
		expect(getConversationMock).not.toHaveBeenCalled();
	});
});

describe("ConversationState active history window", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readHandlers.length = 0;
		messageSentHandlers.length = 0;
		reconcileHandlers.length = 0;
	});

	it("evicts the ninth fetched page, keeps a reply pin, and restores only its cached segment", async () => {
		const allMessages = Array.from({ length: 9 }, (_, index) =>
			message(`page-${index}`, 9_000 - index),
		);
		getConversationMock.mockImplementation(
			({ pageKey }: { pageKey?: string }) => {
				const page = pageKey === undefined ? 0 : Number(pageKey.slice(7));
				return Promise.resolve({
					messages: [allMessages[page]],
					profile,
					pageKey: page < 8 ? `cursor-${page + 1}` : null,
					lastReadTimestamp: null,
				});
			},
		);
		const conversations = conversationsStub();
		conversations.getCachedConversation
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue({
				messages: allMessages,
				profile,
				pageKey: null,
				lastReadTimestamp: null,
			});
		const state = create(conversations);
		await flush();
		state.setReplyTarget(allMessages[0]);

		for (let page = 1; page < 9; page += 1) await state.loadMore();

		expect(state.messages).toHaveLength(9);
		expect(state.messages.map(({ messageId }) => messageId)).toContain(
			"page-0",
		);
		state.clearReplyTarget();
		expect(state.messages).toHaveLength(8);
		expect(state.messages.map(({ messageId }) => messageId)).not.toContain(
			"page-0",
		);

		await expect(state.locateMessage("page-0")).resolves.toBe(0);
		expect(state.messages).toHaveLength(8);
		expect(state.messages.map(({ messageId }) => messageId)).toContain(
			"page-0",
		);
		expect(getConversationMock).toHaveBeenCalledTimes(9);
		expect(
			conversations.setCachedConversation.mock.lastCall?.[1].segments,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ messageIds: ["page-0"] }),
			]),
		);
		expect(
			JSON.stringify(
				conversations.setCachedConversation.mock.lastCall?.[1].segments,
			),
		).not.toContain("body");
	});

	it("reactivates the adjacent newer page after the active window slides older", async () => {
		const allMessages = Array.from({ length: 9 }, (_, index) =>
			message(`page-${index}`, 9_000 - index),
		);
		getConversationMock.mockImplementation(
			({ pageKey }: { pageKey?: string }) => {
				const page = pageKey === undefined ? 0 : Number(pageKey.slice(7));
				return Promise.resolve({
					messages: [allMessages[page]],
					profile,
					pageKey: page < 8 ? `cursor-${page + 1}` : null,
					lastReadTimestamp: null,
				});
			},
		);
		const conversations = conversationsStub();
		conversations.getCachedConversation
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue({
				messages: allMessages,
				profile,
				pageKey: null,
				lastReadTimestamp: null,
			});
		const state = create(conversations);
		await flush();
		for (let page = 1; page < 9; page += 1) await state.loadMore();

		expect(state.messages.map(({ messageId }) => messageId)).not.toContain(
			"page-0",
		);
		await expect(state.loadNewer()).resolves.toBe("loaded");
		expect(state.messages.map(({ messageId }) => messageId)).toContain(
			"page-0",
		);
		expect(state.messages.map(({ messageId }) => messageId)).not.toContain(
			"page-8",
		);
		expect(getConversationMock).toHaveBeenCalledTimes(9);
	});

	it("reloads an evicted known segment by its cursor when its cached body was pruned", async () => {
		const allMessages = Array.from({ length: 9 }, (_, index) =>
			message(`page-${index}`, 9_000 - index),
		);
		getConversationMock.mockImplementation(
			({ pageKey }: { pageKey?: string }) => {
				const page = pageKey === undefined ? 0 : Number(pageKey.slice(7));
				return Promise.resolve({
					messages: [allMessages[page]],
					profile,
					pageKey: page < 8 ? `cursor-${page + 1}` : null,
					lastReadTimestamp: null,
				});
			},
		);
		const conversations = conversationsStub();
		conversations.getCachedConversation
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue({
				messages: allMessages.slice(1),
				profile,
				pageKey: null,
				lastReadTimestamp: null,
			});
		const state = create(conversations);
		await flush();
		for (let page = 1; page < 9; page += 1) await state.loadMore();

		await expect(state.locateMessage("page-0")).resolves.toBe(0);
		expect(state.messages.map(({ messageId }) => messageId)).toContain(
			"page-0",
		);
		expect(getConversationMock).toHaveBeenCalledTimes(10);
	});

	it("does not let repeatedly confirmed sends bypass the eight-page window", async () => {
		const pages = Array.from({ length: 9 }, (_, index) =>
			message(`page-${index}`, 9_000 - index),
		);
		getConversationMock.mockImplementation(
			({ pageKey }: { pageKey?: string }) => {
				const page = pageKey === undefined ? 0 : Number(pageKey.slice(7));
				return Promise.resolve({
					messages: [pages[page]],
					profile,
					pageKey: page < 8 ? `cursor-${page + 1}` : null,
					lastReadTimestamp: null,
				});
			},
		);
		const state = create();
		await flush();

		for (let index = 0; index < 10; index += 1) {
			state.send(outbound("Text", { text: `sent-${index}` }));
			emitMessageSent(echo(`real-${index}`, "Text", { text: `sent-${index}` }));
		}
		for (let page = 1; page < 9; page += 1) await state.loadMore();

		expect(state.messages).toHaveLength(8);
		expect(
			state.messages.some(({ messageId }) => messageId.startsWith("real-")),
		).toBe(false);
	});
});
