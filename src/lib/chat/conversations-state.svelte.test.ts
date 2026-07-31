import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getConversationsMock,
	getConversationMessagesMock,
	markConversationAsReadMock,
	deleteConversationForMeMock,
	setConversationPinnedMock,
	setConversationMutedMock,
	showErrorToastMock,
	showIncomingMessageToastMock,
	reconcileHandlers,
	messageSentHandlers,
} = vi.hoisted(() => ({
	getConversationsMock: vi.fn(),
	getConversationMessagesMock: vi.fn(),
	markConversationAsReadMock: vi.fn(() => Promise.resolve()),
	deleteConversationForMeMock: vi.fn(() => Promise.resolve()),
	setConversationPinnedMock: vi.fn(() => Promise.resolve()),
	setConversationMutedMock: vi.fn(() => Promise.resolve()),
	showErrorToastMock: vi.fn(),
	showIncomingMessageToastMock: vi.fn(),
	reconcileHandlers: [] as (() => void | Promise<void>)[],
	messageSentHandlers: [] as ((event: unknown) => void)[],
}));

vi.mock("$app/state", () => ({ page: { route: { id: "/(protected)/chat" } } }));
vi.mock("$lib/api/error", () => ({ showErrorToast: showErrorToastMock }));
vi.mock("$lib/api/messaging/conversations", () => ({
	getConversations: getConversationsMock,
	markConversationAsRead: markConversationAsReadMock,
	deleteConversationForMe: deleteConversationForMeMock,
	setConversationPinned: setConversationPinnedMock,
	setConversationMuted: setConversationMutedMock,
}));
vi.mock("$lib/api/messaging/messages", () => ({
	getConversationMessages: getConversationMessagesMock,
}));
vi.mock(
	"$lib/components/incoming-message-toast/incoming-message-toast-manager",
	() => ({ showIncomingMessageToast: showIncomingMessageToastMock }),
);
vi.mock("$lib/util/breakpoints.svelte", () => ({
	below: () => ({ current: false }),
}));
vi.mock("$lib/util/reconcile", () => ({
	reconciler: {
		subscribe(handler: () => void | Promise<void>) {
			reconcileHandlers.push(handler);
			return vi.fn();
		},
	},
}));
vi.mock("$lib/ws.svelte", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/ws.svelte")>()),
	ws: {
		on(eventType: string, _schema: unknown, handler: (e: unknown) => void) {
			if (eventType === "chat.v1.message_sent")
				messageSentHandlers.push(handler);
			return Promise.resolve(vi.fn());
		},
	},
}));

import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";
import { ConversationsState } from "./conversations-state.svelte";

const OUR_ID = 1;
const PEER_ID = 2;
type TextMessage = Extract<ApiResponseMessage, { type: "Text" }>;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function conversation(
	conversationId: string,
	lastActivityTimestamp: number,
	overrides: Partial<Conversation["data"]> = {},
): Conversation {
	return {
		type: "full_conversation_v1",
		data: {
			conversationId,
			name: `Conversation ${conversationId}`,
			participants: [
				{
					profileId: PEER_ID,
					primaryMediaHash: null,
					lastOnline: null,
					onlineUntil: null,
					distanceMetres: null,
					position: null,
					isInAList: false,
					hasDatingPotential: false,
				},
			],
			lastActivityTimestamp,
			unreadCount: 0,
			preview: null,
			muted: false,
			pinned: false,
			favorite: false,
			rightNow: "none",
			onlineUntil: null,
			hasUnreadThrob: false,
			...overrides,
		},
	} as unknown as Conversation;
}

function incomingMessage(
	conversationId: string,
	timestamp: number,
	senderId: number,
): TextMessage {
	return {
		messageId: `m-${conversationId}-${timestamp}`,
		conversationId,
		senderId,
		timestamp,
		unsent: false,
		reactions: [],
		type: "Text",
		body: { text: "hi" },
	};
}

function emitMessageSent(payload: unknown) {
	messageSentHandlers[0]?.({ payload });
}

function entryFor(state: ConversationsState, conversationId: string) {
	const entry = state.entries.find(
		(e) => e.data.conversationId === conversationId,
	);
	if (!entry) throw new Error(`no entry for ${conversationId}`);
	return entry;
}

const microtasks = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	vi.clearAllMocks();
	reconcileHandlers.length = 0;
	messageSentHandlers.length = 0;
});

describe("ConversationsState #syncLatest single-flight (P1.8)", () => {
	it("coalesces concurrent ensureLoaded into one page-1 fetch", async () => {
		getConversationsMock.mockResolvedValue({ entries: [], nextPage: null });
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		getConversationsMock.mockClear();

		const gate = deferred<{
			entries: Conversation[];
			nextPage: number | null;
		}>();
		getConversationsMock.mockReturnValueOnce(gate.promise);

		const first = state.ensureLoaded("a:1");
		const second = state.ensureLoaded("b:2");
		gate.resolve({ entries: [], nextPage: null });
		await Promise.all([first, second]);

		expect(getConversationsMock).toHaveBeenCalledTimes(1);
	});

	it("allows a fresh sync after the previous one settles", async () => {
		getConversationsMock.mockResolvedValue({ entries: [], nextPage: null });
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		getConversationsMock.mockClear();

		await state.ensureLoaded("a:1");
		await state.ensureLoaded("b:2");

		expect(getConversationsMock).toHaveBeenCalledTimes(2);
	});
});

describe("ConversationsState markRead rollback (P1.9)", () => {
	it("restores unread additively when mark-read fails after a concurrent increment", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000, { unreadCount: 3 })],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		const gate = deferred<void>();
		markConversationAsReadMock.mockReturnValueOnce(gate.promise);

		const markPromise = state.markRead("a:1");
		expect(entryFor(state, "a:1").data.unreadCount).toBe(0);

		emitMessageSent(incomingMessage("a:1", 2000, PEER_ID));
		expect(entryFor(state, "a:1").data.unreadCount).toBe(1);

		gate.reject(new Error("mark-read failed"));
		await markPromise;

		expect(entryFor(state, "a:1").data.unreadCount).toBe(4);
	});
});

describe("ConversationsState epoch guards (P1.7)", () => {
	it("does not let a stale loadMore resurrect nextPage after a reconcile ends the list", async () => {
		getConversationsMock.mockResolvedValueOnce({
			entries: [conversation("a:1", 1000)],
			nextPage: 2,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		expect(state.nextPage).toBe(2);

		const loadGate = deferred<{
			entries: Conversation[];
			nextPage: number | null;
		}>();
		getConversationsMock.mockReturnValueOnce(loadGate.promise);
		const loadPromise = state.loadMore();

		getConversationsMock.mockResolvedValueOnce({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		await reconcileHandlers[0]?.();
		expect(state.nextPage).toBeNull();

		loadGate.resolve({ entries: [conversation("b:2", 500)], nextPage: 3 });
		await loadPromise;
		await microtasks();

		expect(state.nextPage).toBeNull();
	});

	it("keeps the initial load's result when a reconcile races it and then fails", async () => {
		const initGate = deferred<{
			entries: Conversation[];
			nextPage: number | null;
		}>();
		getConversationsMock.mockReturnValueOnce(initGate.promise);
		const state = new ConversationsState(OUR_ID);

		const reconcilePromise = reconcileHandlers[0]?.();
		await microtasks();

		getConversationsMock.mockRejectedValueOnce(new Error("network"));
		initGate.resolve({ entries: [conversation("a:1", 1000)], nextPage: 2 });
		await state.initial;
		await reconcilePromise;

		expect(state.entries.map((e) => e.data.conversationId)).toEqual(["a:1"]);
		expect(state.nextPage).toBe(2);
	});

	it("discards a reconcile's stale writes when a loadMore supersedes it mid-paging", async () => {
		getConversationsMock.mockResolvedValueOnce({
			entries: [conversation("a:1", 1000)],
			nextPage: 2,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		expect(state.nextPage).toBe(2);

		const reconcileGate = deferred<{
			entries: Conversation[];
			nextPage: number | null;
		}>();
		getConversationsMock.mockReturnValueOnce(reconcileGate.promise);
		const reconcilePromise = reconcileHandlers[0]?.();
		await microtasks();

		getConversationsMock.mockResolvedValueOnce({
			entries: [conversation("b:2", 500)],
			nextPage: 5,
		});
		await state.loadMore();
		expect(state.nextPage).toBe(5);

		reconcileGate.resolve({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		await reconcilePromise;

		expect(state.nextPage).toBe(5);
	});
});

describe("ConversationsState loaded-chat message search", () => {
	it("searches every message page, deduplicates overlaps, and reuses the completed corpus", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		getConversationMessagesMock.mockImplementation(
			({ pageKey }: { pageKey?: string }) => {
				if (pageKey === undefined) {
					return Promise.resolve({
						lastReadTimestamp: null,
						messages: [
							{
								...incomingMessage("a:1", 3000, PEER_ID),
								messageId: "m-1",
								body: { text: "ordinary text" },
							},
						],
						profile: {},
					});
				}
				if (pageKey === "m-1") {
					return Promise.resolve({
						lastReadTimestamp: null,
						messages: [
							{
								...incomingMessage("a:1", 3000, PEER_ID),
								messageId: "m-1",
								body: { text: "ordinary text" },
							},
							{
								...incomingMessage("a:1", 2000, PEER_ID),
								messageId: "m-2",
								body: { text: "the old needle is here" },
							},
						],
						profile: {},
					});
				}
				return Promise.resolve({
					lastReadTimestamp: null,
					messages: [],
					profile: {},
				});
			},
		);

		await state.searchLoadedMessages("needle");

		expect(
			getConversationMessagesMock.mock.calls.map(([args]) => args.pageKey),
		).toEqual([undefined, "m-1", "m-2"]);
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
		expect(state.messageSearchStatus).toBe("complete");
		expect(state.messageSearchScanned).toBe(1);
		expect(state.messageSearchTotal).toBe(1);

		getConversationMessagesMock.mockClear();
		await state.searchLoadedMessages("ordinary");

		expect(getConversationMessagesMock).not.toHaveBeenCalled();
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("limits concurrent history hydration to three loaded chats", async () => {
		getConversationsMock.mockResolvedValue({
			entries: Array.from({ length: 5 }, (_, index) =>
				conversation(`c:${index}`, 1000 - index),
			),
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		let active = 0;
		let maxActive = 0;
		getConversationMessagesMock.mockImplementation(
			async ({ pageKey }: { pageKey?: string }) => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active -= 1;
				return {
					lastReadTimestamp: null,
					messages:
						pageKey === undefined
							? [
									{
										...incomingMessage("unused", 1, PEER_ID),
										messageId: crypto.randomUUID(),
									},
								]
							: [],
					profile: {},
				};
			},
		);

		await state.searchLoadedMessages("not present");

		expect(maxActive).toBe(3);
		expect(state.messageSearchStatus).toBe("complete");
		expect(state.messageSearchScanned).toBe(5);
	});

	it("reports partial results when one loaded chat cannot be searched", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000), conversation("b:2", 900)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		getConversationMessagesMock.mockImplementation(
			({ conversationId }: { conversationId: string }) =>
				conversationId === "a:1"
					? Promise.reject(new Error("rate limited"))
					: Promise.resolve({
							lastReadTimestamp: null,
							messages: [],
							profile: {},
						}),
		);

		await state.searchLoadedMessages("needle");

		expect(state.messageSearchStatus).toBe("partial");
		expect(state.messageSearchFailureCount).toBe(1);
		expect(state.messageSearchScanned).toBe(2);
		expect(state.messageSearchMatchIds).toEqual([]);
	});

	it("resumes an incomplete corpus from the failed page on retry", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		getConversationMessagesMock
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 3000, PEER_ID),
						messageId: "m-1",
						body: { text: "ordinary text" },
					},
				],
				profile: {},
			})
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 2000, PEER_ID),
						messageId: "m-2",
						body: { text: "the needle is here" },
					},
				],
				profile: {},
			})
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});

		await state.searchLoadedMessages("needle");
		expect(state.messageSearchStatus).toBe("partial");

		await state.searchLoadedMessages("needle");

		expect(
			getConversationMessagesMock.mock.calls.map(([args]) => args.pageKey),
		).toEqual([undefined, "m-1", "m-1", "m-2"]);
		expect(state.messageSearchStatus).toBe("complete");
		expect(state.messageSearchFailureCount).toBe(0);
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("continues from messages already cached by an open chat", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		state.setCachedConversation("a:1", {
			messages: [
				{
					...incomingMessage("a:1", 3000, PEER_ID),
					messageId: "m-cached",
					body: { text: "cached needle" },
				},
			],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: PEER_ID,
				showDistance: false,
			},
			pageKey: "m-cached",
			lastReadTimestamp: null,
		});
		getConversationMessagesMock.mockResolvedValue({
			lastReadTimestamp: null,
			messages: [],
			profile: {},
		});

		await state.searchLoadedMessages("needle");

		expect(getConversationMessagesMock).toHaveBeenCalledWith(
			expect.objectContaining({ pageKey: "m-cached" }),
		);
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("updates active results when matching messages are deleted or unsent", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		const matchingMessage = {
			...incomingMessage("a:1", 3000, PEER_ID),
			messageId: "m-match",
			body: { text: "needle" },
		};
		state.setCachedConversation("a:1", {
			messages: [matchingMessage],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: PEER_ID,
				showDistance: false,
			},
			pageKey: null,
			lastReadTimestamp: null,
		});

		await state.searchLoadedMessages("needle");
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);

		state.removeMessageFromSearch("a:1", matchingMessage.messageId);
		expect(state.messageSearchMatchIds).toEqual([]);

		state.setCachedConversation("a:1", {
			messages: [matchingMessage],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: PEER_ID,
				showDistance: false,
			},
			pageKey: null,
			lastReadTimestamp: null,
		});
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);

		state.setCachedConversation("a:1", {
			messages: [
				{
					...matchingMessage,
					type: "Unsent",
					unsent: true,
					body: null,
				},
			],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: PEER_ID,
				showDistance: false,
			},
			pageKey: null,
			lastReadTimestamp: null,
		});
		expect(state.messageSearchMatchIds).toEqual([]);
	});

	it("preserves older complete-history matches when an open chat caches a partial page", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		getConversationMessagesMock
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 3000, PEER_ID),
						messageId: "m-recent",
						body: { text: "ordinary recent text" },
					},
					{
						...incomingMessage("a:1", 1000, PEER_ID),
						messageId: "m-old",
						body: { text: "old needle" },
					},
				],
				profile: {},
			})
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});
		await state.searchLoadedMessages("needle");
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);

		state.setCachedConversation("a:1", {
			messages: [
				{
					...incomingMessage("a:1", 3000, PEER_ID),
					messageId: "m-recent",
					body: { text: "ordinary recent text" },
				},
			],
			profile: {
				distance: null,
				mediaHash: null,
				name: null,
				onlineUntil: null,
				profileId: PEER_ID,
				showDistance: false,
			},
			pageKey: "m-recent",
			lastReadTimestamp: null,
		});

		expect(state.messageSearchStatus).toBe("complete");
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
		getConversationMessagesMock.mockClear();
		await state.searchLoadedMessages("needle");
		expect(getConversationMessagesMock).not.toHaveBeenCalled();
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("invalidates a completed corpus when reconciliation advances activity", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		getConversationMessagesMock
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 1000, PEER_ID),
						messageId: "m-old",
						body: { text: "old needle" },
					},
				],
				profile: {},
			})
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});
		await state.searchLoadedMessages("needle");
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);

		getConversationsMock.mockResolvedValueOnce({
			entries: [conversation("a:1", 2000)],
			nextPage: null,
		});
		await reconcileHandlers[0]?.();
		getConversationMessagesMock
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 2000, PEER_ID),
						messageId: "m-new",
						body: { text: "new needle" },
					},
				],
				profile: {},
			})
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});

		await state.searchLoadedMessages("needle");

		expect(getConversationMessagesMock).toHaveBeenCalledTimes(4);
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("globally bounds native history requests across query changes", async () => {
		getConversationsMock.mockResolvedValue({
			entries: Array.from({ length: 6 }, (_, index) =>
				conversation(`c:${index}`, 1000 - index),
			),
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		const gates = Array.from({ length: 3 }, () =>
			deferred<{
				lastReadTimestamp: null;
				messages: [];
				profile: Record<string, never>;
			}>(),
		);
		let active = 0;
		let maxActive = 0;
		let gateIndex = 0;
		getConversationMessagesMock.mockImplementation(() => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			const gate = gates[gateIndex++];
			const result =
				gate?.promise ??
				Promise.resolve({
					lastReadTimestamp: null,
					messages: [],
					profile: {},
				});
			return result.finally(() => {
				active -= 1;
			});
		});

		const firstSearch = state.searchLoadedMessages("first");
		await microtasks();
		expect(active).toBe(3);

		const secondSearch = state.searchLoadedMessages("second");
		await microtasks();
		expect(active).toBe(3);
		expect(maxActive).toBe(3);

		for (const gate of gates) {
			gate.resolve({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});
		}
		await Promise.all([firstSearch, secondSearch]);

		expect(maxActive).toBe(3);
		expect(state.messageSearchQuery).toBe("second");
		expect(state.messageSearchStatus).toBe("complete");
	});

	it("keeps changed queries pending and rejects stale search publication", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;
		const oldGate = deferred<{
			lastReadTimestamp: null;
			messages: ReturnType<typeof incomingMessage>[];
			profile: Record<string, never>;
		}>();
		getConversationMessagesMock
			.mockReturnValueOnce(oldGate.promise)
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [
					{
						...incomingMessage("a:1", 2000, PEER_ID),
						messageId: "m-new",
						body: { text: "new needle" },
					},
				],
				profile: {},
			})
			.mockResolvedValueOnce({
				lastReadTimestamp: null,
				messages: [],
				profile: {},
			});

		const oldSearch = state.searchLoadedMessages("old needle");
		await microtasks();
		state.cancelMessageSearch("new needle");
		expect(state.messageSearchStatus).toBe("searching");
		const newSearch = state.searchLoadedMessages("new needle");

		oldGate.resolve({
			lastReadTimestamp: null,
			messages: [incomingMessage("a:1", 3000, PEER_ID)],
			profile: {},
		});
		await Promise.all([oldSearch, newSearch]);

		expect(state.messageSearchQuery).toBe("new needle");
		expect(state.messageSearchStatus).toBe("complete");
		expect(state.messageSearchMatchIds).toEqual(["a:1"]);
	});

	it("aborts and clears account-scoped search state on destroy", async () => {
		getConversationsMock.mockResolvedValue({
			entries: [conversation("a:1", 1000)],
			nextPage: null,
		});
		const state = new ConversationsState(OUR_ID);
		await state.initial;

		const gate = deferred<{
			lastReadTimestamp: null;
			messages: ReturnType<typeof incomingMessage>[];
			profile: Record<string, never>;
		}>();
		getConversationMessagesMock.mockReturnValueOnce(gate.promise);
		const search = state.searchLoadedMessages("needle");
		await microtasks();

		const abortController = getConversationMessagesMock.mock.calls[0][0]
			.abortController as AbortController;
		const destroy = state.destroy();
		expect(abortController.signal.aborted).toBe(true);

		gate.resolve({
			lastReadTimestamp: null,
			messages: [incomingMessage("a:1", 1000, PEER_ID)],
			profile: {},
		});
		await Promise.all([search, destroy]);

		expect(state.messageSearchStatus).toBe("idle");
		expect(state.messageSearchMatchIds).toEqual([]);
	});
});
