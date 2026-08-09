import { beforeEach, describe, expect, it } from "vitest";

import {
	activateAccountSession,
	getAccountSessionSnapshot,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import {
	NAVIGATION_MEMORY_DRAFT_CAPACITY,
	NavigationMemory,
	navigationMemory,
	resolveConversationScrollRestoration,
	resolveReplyTarget,
	resolveScrollRestoration,
	restoreVirtualScrollAnchor,
	type ScrollAnchor,
	ScrollCaptureGate,
} from "$lib/navigation/navigation-memory";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

const anchor = (itemKey: string, fallbackOffsetPx = 0): ScrollAnchor => ({
	itemKey,
	offsetPx: -12,
	fallbackOffsetPx,
	capturedAt: 1234,
});

describe("NavigationMemory", () => {
	beforeEach(() => {
		invalidateAccountSession();
	});

	it("clears account-scoped anchors and drafts before another account can read them", () => {
		const first = activateAccountSession(101);
		navigationMemory.setSurfaceAnchor(
			"interestViews",
			anchor("profile:77"),
			first,
		);
		navigationMemory.updateDraft(
			"conversation-private-a",
			{ text: "private draft", replyTargetMessageId: "message-private-a" },
			first,
		);

		const second = activateAccountSession(202);

		expect(
			navigationMemory.getSurfaceAnchor("interestViews", second),
		).toBeNull();
		expect(
			navigationMemory.getDetailSession("conversation-private-a", second),
		).toEqual({
			scrollAnchor: null,
			scrollNeighborhood: null,
			draftText: "",
			replyTargetMessageId: null,
		});
	});

	it("rejects late writes captured under an obsolete account generation", () => {
		const stale = activateAccountSession(303);
		const current = activateAccountSession(404);

		expect(
			navigationMemory.setSurfaceAnchor("interestTaps", anchor("55"), stale),
		).toBe(false);
		expect(
			navigationMemory.updateDraft(
				"conversation-old",
				{ text: "late private draft", replyTargetMessageId: null },
				stale,
			),
		).toBe(false);
		expect(
			navigationMemory.getSurfaceAnchor("interestTaps", current),
		).toBeNull();
		expect(
			navigationMemory.getDetailSession("conversation-old", current).draftText,
		).toBe("");
	});

	it("keeps exactly 20 drafts and evicts the least recently used on the 21st", () => {
		const session = activateAccountSession(505);
		const memory = new NavigationMemory();
		for (let index = 1; index <= NAVIGATION_MEMORY_DRAFT_CAPACITY; index += 1) {
			memory.updateDraft(
				`conversation-${index}`,
				{ text: `draft-${index}`, replyTargetMessageId: null },
				session,
			);
		}

		memory.updateDraft(
			"conversation-21",
			{ text: "draft-21", replyTargetMessageId: null },
			session,
		);

		expect(memory.getDetailSession("conversation-1", session).draftText).toBe(
			"",
		);
		expect(memory.getDetailSession("conversation-2", session).draftText).toBe(
			"draft-2",
		);
		expect(memory.getDetailSession("conversation-21", session).draftText).toBe(
			"draft-21",
		);
	});

	it("touches draft recency on reads and updates", () => {
		const session = activateAccountSession(606);
		const memory = new NavigationMemory();
		for (let index = 1; index <= NAVIGATION_MEMORY_DRAFT_CAPACITY; index += 1) {
			memory.updateDraft(
				`conversation-${index}`,
				{ text: `draft-${index}`, replyTargetMessageId: null },
				session,
			);
		}
		expect(memory.getDetailSession("conversation-1", session).draftText).toBe(
			"draft-1",
		);
		memory.updateDraft(
			"conversation-2",
			{ text: "updated", replyTargetMessageId: null },
			session,
		);

		memory.updateDraft(
			"conversation-21",
			{ text: "draft-21", replyTargetMessageId: null },
			session,
		);

		expect(memory.getDetailSession("conversation-1", session).draftText).toBe(
			"draft-1",
		);
		expect(memory.getDetailSession("conversation-2", session).draftText).toBe(
			"updated",
		);
		expect(memory.getDetailSession("conversation-3", session).draftText).toBe(
			"",
		);
	});

	it("clears a transferred draft but retains it when ownership was not transferred", () => {
		const session = activateAccountSession(707);
		const memory = new NavigationMemory();
		memory.updateDraft(
			"conversation-send",
			{ text: "keep until owned", replyTargetMessageId: "reply-1" },
			session,
		);

		expect(memory.getDetailSession("conversation-send", session)).toMatchObject(
			{
				draftText: "keep until owned",
				replyTargetMessageId: "reply-1",
			},
		);

		memory.clearDraft("conversation-send", session);
		expect(memory.getDetailSession("conversation-send", session)).toMatchObject(
			{
				draftText: "",
				replyTargetMessageId: null,
			},
		);
	});

	it("resolves a reply target only from current messages in the same conversation", () => {
		const valid = {
			messageId: "message-1",
			conversationId: "conversation-a",
		} as ApiResponseMessage;
		const wrongConversation = {
			messageId: "message-1",
			conversationId: "conversation-b",
		} as ApiResponseMessage;

		expect(
			resolveReplyTarget("conversation-a", "message-1", [
				wrongConversation,
				valid,
			]),
		).toBe(valid);
		expect(
			resolveReplyTarget("conversation-a", "message-1", [wrongConversation]),
		).toBeNull();
		expect(resolveReplyTarget("conversation-a", null, [valid])).toBeNull();
	});

	it("uses exact measurement, then the closest surviving prior neighbor", () => {
		const saved = anchor("profile:2", 480);
		const neighborhood = {
			orderedItemKeys: ["profile:1", "profile:2", "profile:3", "profile:4"],
			anchorIndex: 1,
		};

		expect(
			resolveScrollRestoration(saved, new Map([["profile:2", 300]])),
		).toEqual({ itemKey: "profile:2", scrollTop: 312 });
		expect(
			resolveScrollRestoration(
				saved,
				new Map([
					["profile:4", 120],
					["profile:3", 760],
				]),
				neighborhood,
			),
		).toEqual({ itemKey: "profile:3", scrollTop: 772 });
	});

	it("survives deletion and reorder, using raw fallback only without a recorded neighbor", () => {
		const saved = anchor("profile:3", 480);
		const neighborhood = {
			orderedItemKeys: ["profile:1", "profile:2", "profile:3", "profile:4"],
			anchorIndex: 2,
		};

		expect(
			resolveScrollRestoration(
				saved,
				new Map([
					["unrelated", 470],
					["profile:1", 820],
				]),
				neighborhood,
			),
		).toEqual({ itemKey: "profile:1", scrollTop: 832 });
		expect(resolveScrollRestoration(saved, new Map())).toEqual({
			itemKey: null,
			scrollTop: 480,
		});
		expect(
			resolveScrollRestoration(
				saved,
				new Map([["unrelated", 470]]),
				neighborhood,
			),
		).toEqual({ itemKey: null, scrollTop: 480 });
	});

	it("locates virtual anchors by logical key across responsive reflow and reorder", async () => {
		const container = document.createElement("div");
		container.getBoundingClientRect = () => ({
			top: 100,
			bottom: 500,
			left: 0,
			right: 100,
			width: 100,
			height: 400,
			x: 0,
			y: 100,
			toJSON: () => ({}),
		});
		const saved = anchor("profile:8", 480);
		const logicalKeys = ["profile:3", "profile:8", "profile:1", "profile:2"];
		const scrolled: number[] = [];

		const restored = await restoreVirtualScrollAnchor({
			container,
			anchor: saved,
			logicalItemKeys: logicalKeys,
			toVirtualIndex: (itemIndex) => Math.floor(itemIndex / 2),
			scrollToIndex: (index) => {
				scrolled.push(index);
				const item = document.createElement("div");
				item.dataset.navigationItemKey = "profile:8";
				item.getBoundingClientRect = () => ({
					top: 130,
					bottom: 210,
					left: 0,
					right: 100,
					width: 100,
					height: 80,
					x: 0,
					y: 130,
					toJSON: () => ({}),
				});
				container.replaceChildren(item);
				return Promise.resolve();
			},
		});

		expect(scrolled).toEqual([0]);
		expect(restored).toEqual({ itemKey: "profile:8", scrollTop: 42 });
	});

	it("locates the nearest surviving virtual neighbor after deletion or expiry", async () => {
		const container = document.createElement("div");
		container.getBoundingClientRect = () => ({
			top: 0,
			bottom: 400,
			left: 0,
			right: 100,
			width: 100,
			height: 400,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});
		const saved = anchor("expired", 700);
		const neighborhood = {
			orderedItemKeys: ["older", "expired", "newer"],
			anchorIndex: 1,
		};
		let scrolledTo = -1;

		const restored = await restoreVirtualScrollAnchor({
			container,
			anchor: saved,
			neighborhood,
			logicalItemKeys: ["newer", "unrelated"],
			scrollToIndex: (index) => {
				scrolledTo = index;
				const item = document.createElement("div");
				item.dataset.navigationItemKey = "newer";
				item.getBoundingClientRect = () => ({
					top: 50,
					bottom: 130,
					left: 0,
					right: 100,
					width: 100,
					height: 80,
					x: 0,
					y: 50,
					toJSON: () => ({}),
				});
				container.replaceChildren(item);
				return Promise.resolve();
			},
		});

		expect(scrolledTo).toBe(0);
		expect(restored).toEqual({ itemKey: "newer", scrollTop: 62 });
	});

	it("restores transcript end-distance only for an at-end capture", () => {
		const saved = { ...anchor("message:2", 480), distanceFromEndPx: 8 };
		expect(
			resolveConversationScrollRestoration(
				saved,
				new Map([["message:2", 250]]),
				{ scrollHeight: 1_000, clientHeight: 300, floorSlopPx: 16 },
			),
		).toEqual({ itemKey: null, scrollTop: 692 });

		const midHistory = { ...saved, distanceFromEndPx: 120 };
		expect(
			resolveConversationScrollRestoration(
				midHistory,
				new Map([["message:2", 250]]),
				{ scrollHeight: 1_000, clientHeight: 300, floorSlopPx: 16 },
			),
		).toEqual({ itemKey: "message:2", scrollTop: 262 });
		expect(
			resolveConversationScrollRestoration(midHistory, new Map(), {
				scrollHeight: 1_000,
				clientHeight: 300,
				floorSlopPx: 16,
			}),
		).toEqual({ itemKey: null, scrollTop: 480 });
	});

	it("suppresses capture for the complete programmatic refresh flight", async () => {
		const gate = new ScrollCaptureGate();
		let finish!: () => void;
		const refresh = new Promise<void>((resolve) => (finish = resolve));

		const active = gate.suppressDuring(() => refresh);
		expect(gate.canCapture).toBe(false);
		finish();
		await active;
		expect(gate.canCapture).toBe(true);
	});

	it("does not expose drafts or entity anchors through serialization", () => {
		const session = activateAccountSession(808);
		const memory = new NavigationMemory();
		memory.setSurfaceAnchor("browse", anchor("private-profile-id"), session);
		memory.updateDraft(
			"private-conversation-id",
			{
				text: "private draft body",
				replyTargetMessageId: "private-message-id",
			},
			session,
		);

		expect(JSON.stringify(memory)).toBe("{}");
		expect(Object.keys(memory)).toEqual([]);
		expect(getAccountSessionSnapshot()).toEqual(session);
	});
});
