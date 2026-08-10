// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScrollToBottomButton from "./ScrollToBottomButton.svelte";

vi.mock("../conversation-state.svelte", () => ({
	getConversationState: () => () => ({
		messages: [],
		ourProfileId: "self",
	}),
}));

afterEach(cleanup);
beforeEach(() => {
	Element.prototype.animate = vi.fn(() => ({
		cancel: vi.fn(),
		finished: Promise.resolve(),
	})) as unknown as typeof Element.prototype.animate;
});

describe("ScrollToBottomButton", () => {
	it("shares the composer IME-aware bottom coordinate system", () => {
		const view = render(ScrollToBottomButton, {
			onclick: () => undefined,
			seenTimestamp: 0,
		});
		const wrapper = view.getByRole("button", {
			name: "Scroll to newest messages",
		}).parentElement;

		expect(wrapper?.style.bottom).toContain("--chat-ime-offset");
		expect(wrapper?.style.bottom).toContain("--composer-height");
	});
});
