import { Virtualizer } from "@tanstack/svelte-virtual";
import { describe, expect, it } from "vitest";

import {
	conversationListVirtualizerOptions,
	resolveConversationRestoreTarget,
} from "./conversation-list-window";

const ids = (count: number) =>
	Array.from({ length: count }, (_, index) => `conversation-${index}`);

describe("conversation list window", () => {
	it("keeps a 1,000-conversation list bounded and keyed by conversation identity", () => {
		const conversationIds = ids(1_000);
		const virtualizer = new Virtualizer(
			conversationListVirtualizerOptions(conversationIds, () => null, {
				height: 800,
				width: 420,
			}),
		);
		virtualizer.scrollRect = { height: 800, width: 420 };
		virtualizer.scrollOffset = 0;
		virtualizer.calculateRange();

		const firstWindow = virtualizer.getVirtualItems();
		expect(firstWindow.length).toBeGreaterThan(0);
		expect(firstWindow.length).toBeLessThan(50);
		expect(firstWindow[0]?.key).toBe("conversation-0");

		virtualizer.scrollOffset = 90_000;
		virtualizer.calculateRange();
		const distantWindow = virtualizer.getVirtualItems();
		expect(distantWindow.length).toBeLessThan(50);
		expect(distantWindow.some((row) => row.key === "conversation-0")).toBe(
			false,
		);
		expect(new Set(distantWindow.map((row) => row.key)).size).toBe(
			distantWindow.length,
		);
	});

	it("restores an offscreen anchor by exact key, then closest surviving neighbor", () => {
		const conversationIds = ids(1_000);
		const neighborhood = {
			orderedItemKeys: [
				"conversation-697",
				"conversation-698",
				"conversation-699",
				"conversation-700",
				"conversation-701",
			],
			anchorIndex: 3,
		};

		expect(
			resolveConversationRestoreTarget(
				conversationIds,
				"conversation-700",
				neighborhood,
			),
		).toEqual({ index: 700, itemKey: "conversation-700" });

		const withoutAnchor = conversationIds.filter(
			(id) => id !== "conversation-700" && id !== "conversation-699",
		);
		expect(
			resolveConversationRestoreTarget(
				withoutAnchor,
				"conversation-700",
				neighborhood,
			),
		).toEqual({ index: 699, itemKey: "conversation-701" });
	});
});
