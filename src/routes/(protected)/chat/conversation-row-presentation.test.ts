import { describe, expect, it } from "vitest";

import { conversationRowPresentation } from "./conversation-row-presentation";

describe("conversation row presentation", () => {
	it("lets active selection dominate unread tone without losing unread emphasis", () => {
		expect(conversationRowPresentation({ active: true, unread: true })).toEqual(
			{
				ariaCurrent: "page",
				leadingCue: true,
				tone: "active",
				unreadEmphasis: true,
			},
		);
	});

	it("uses a quieter unread tone and a neutral ordinary tone", () => {
		expect(
			conversationRowPresentation({ active: false, unread: true }),
		).toEqual({
			ariaCurrent: undefined,
			leadingCue: true,
			tone: "unread",
			unreadEmphasis: true,
		});
		expect(
			conversationRowPresentation({ active: false, unread: false }),
		).toEqual({
			ariaCurrent: undefined,
			leadingCue: false,
			tone: "neutral",
			unreadEmphasis: false,
		});
	});
});
