import { describe, expect, it } from "vitest";

import { ActiveMessageWindow } from "./active-message-window";

type TestMessage = {
	messageId: string;
	timestamp: number;
	body: string;
};

function message(messageId: string, timestamp: number): TestMessage {
	return { messageId, timestamp, body: `body-${messageId}` };
}

describe("ActiveMessageWindow", () => {
	it("retains at most eight fetched pages while keeping explicit pins", () => {
		const window = new ActiveMessageWindow<TestMessage>({ maxFetchedPages: 8 });

		for (let page = 0; page < 9; page += 1) {
			window.addOlderPage({
				cursor: page === 0 ? null : `cursor-${page}`,
				nextCursor: `cursor-${page + 1}`,
				messages: [message(`message-${page}`, 10_000 - page)],
			});
		}
		window.pin(message("optimistic", 20_000), "optimistic");
		window.pin(message("reply", 5_000), "reply-target");
		window.pin(message("selected", 4_000), "selected");
		window.pin(message("viewer", 3_000), "viewer");

		expect(window.activeFetchedPageCount).toBe(8);
		expect(window.messages.map((item) => item.messageId)).toEqual([
			"optimistic",
			"message-1",
			"message-2",
			"message-3",
			"message-4",
			"message-5",
			"message-6",
			"message-7",
			"message-8",
			"reply",
			"selected",
			"viewer",
		]);
	});

	it("retains identity-only metadata and restores only the located evicted page", () => {
		const window = new ActiveMessageWindow<TestMessage>({ maxFetchedPages: 2 });
		window.addOlderPage({
			cursor: null,
			nextCursor: "cursor-1",
			messages: [message("newest", 3)],
		});
		window.addOlderPage({
			cursor: "cursor-1",
			nextCursor: "cursor-2",
			messages: [message("middle", 2)],
		});
		window.addOlderPage({
			cursor: "cursor-2",
			nextCursor: null,
			messages: [message("oldest", 1)],
		});

		const located = window.locateMessage("newest");
		expect(located).toEqual({ kind: "evicted", segmentId: expect.any(String) });
		expect(window.segmentMetadata).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cursor: null,
					nextCursor: "cursor-1",
					messageIds: ["newest"],
				}),
			]),
		);
		expect(JSON.stringify(window.segmentMetadata)).not.toContain("body-newest");

		if (located.kind !== "evicted") throw new Error("expected evicted page");
		window.restoreSegment(located.segmentId, [message("newest", 3)]);

		expect(window.messages.map((item) => item.messageId)).toEqual([
			"newest",
			"middle",
		]);
		expect(window.activeFetchedPageCount).toBe(2);
		expect(window.locateMessage("newest")).toEqual({
			kind: "active",
			index: 0,
		});
	});

	it("keeps one record pinned until every pin reason is released", () => {
		const window = new ActiveMessageWindow<TestMessage>({ maxFetchedPages: 1 });
		const pinned = message("multi-pin", 1);
		window.pin(pinned, "reply-target");
		window.pin(pinned, "viewer");

		window.unpin("multi-pin", "reply-target");
		expect(window.messages.map((item) => item.messageId)).toContain(
			"multi-pin",
		);

		window.unpin("multi-pin", "viewer");
		expect(window.messages.map((item) => item.messageId)).not.toContain(
			"multi-pin",
		);
	});

	it("exposes and restores the adjacent newer segment after the window slides older", () => {
		const window = new ActiveMessageWindow<TestMessage>({ maxFetchedPages: 2 });
		window.addOlderPage({
			cursor: null,
			nextCursor: "cursor-1",
			messages: [message("newest", 3)],
		});
		window.addOlderPage({
			cursor: "cursor-1",
			nextCursor: "cursor-2",
			messages: [message("middle", 2)],
		});
		window.addOlderPage({
			cursor: "cursor-2",
			nextCursor: null,
			messages: [message("oldest", 1)],
		});

		const newer = window.getAdjacentNewerSegment();
		expect(newer).toEqual(
			expect.objectContaining({ cursor: null, messageIds: ["newest"] }),
		);
		if (!newer) throw new Error("expected newer segment");
		expect(window.restoreSegment(newer.segmentId, [message("newest", 3)])).toBe(
			true,
		);
		expect(window.messages.map((item) => item.messageId)).toEqual([
			"newest",
			"middle",
		]);
		expect(window.getAdjacentNewerSegment()).toBeNull();
	});

	it("hydrates identity metadata for a segment whose durable body was pruned", () => {
		const window = new ActiveMessageWindow<TestMessage>({ maxFetchedPages: 2 });
		window.hydrateSegment(
			{
				segmentId: "root:newest:newest",
				cursor: null,
				nextCursor: "cursor-1",
				messageIds: ["newest"],
			},
			[],
		);
		window.hydrateSegment(
			{
				segmentId: "cursor-1:middle:middle",
				cursor: "cursor-1",
				nextCursor: null,
				messageIds: ["middle"],
			},
			[message("middle", 2)],
		);

		expect(window.locateMessage("newest")).toEqual({
			kind: "evicted",
			segmentId: "root:newest:newest",
		});
		expect(window.getSegmentMetadata("root:newest:newest")).toEqual({
			segmentId: "root:newest:newest",
			cursor: null,
			nextCursor: "cursor-1",
			messageIds: ["newest"],
		});
	});
});
