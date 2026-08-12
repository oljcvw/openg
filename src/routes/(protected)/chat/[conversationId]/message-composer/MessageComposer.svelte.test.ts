// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listSavedPhrasesMock, subscribeSavedPhrasesMock } = vi.hoisted(() => ({
	listSavedPhrasesMock: vi.fn(() => Promise.resolve([])),
	subscribeSavedPhrasesMock: vi.fn(() => () => {}),
}));

vi.mock("$lib/app-data/saved-phrases", () => ({
	filterSavedPhrases: () => [],
	listSavedPhrases: listSavedPhrasesMock,
	subscribeSavedPhrases: subscribeSavedPhrasesMock,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import { navigationMemory } from "$lib/navigation/navigation-memory";
import MessageComposer from "./MessageComposer.svelte";

describe("MessageComposer navigation-memory draft", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		invalidateAccountSession();
		vi.stubGlobal(
			"ResizeObserver",
			class ResizeObserverStub {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: () => ({
				cancel() {},
				onfinish: null,
			}),
		});
	});

	afterEach(() => {
		cleanup();
		delete (HTMLElement.prototype as { animate?: unknown }).animate;
		vi.unstubAllGlobals();
	});

	it("restores and updates a draft within the same account conversation", async () => {
		const accountSession = activateAccountSession(1001);
		navigationMemory.updateDraft(
			"conversation-a",
			{ text: "restored text", replyTargetMessageId: null },
			accountSession,
		);
		render(MessageComposer, {
			onSend: vi.fn(),
			disabled: false,
			accountProfileId: 1001,
			conversationId: "conversation-a",
			accountSession,
		});

		const input = screen.getByPlaceholderText("Say something...");
		expect((input as HTMLTextAreaElement).value).toBe("restored text");
		await fireEvent.input(input, { target: { value: "updated text" } });
		await waitFor(() =>
			expect(
				navigationMemory.getDetailSession("conversation-a", accountSession)
					.draftText,
			).toBe("updated text"),
		);
	});

	it("clears composer only after send returns accepted ownership", async () => {
		const accountSession = activateAccountSession(1002);
		const onSend = vi.fn(() =>
			Promise.resolve({ kind: "accepted" as const, operationId: "pending-1" }),
		);
		render(MessageComposer, {
			onSend,
			disabled: false,
			accountProfileId: 1002,
			conversationId: "conversation-b",
			accountSession,
		});
		const input = screen.getByPlaceholderText("Say something...");
		await fireEvent.input(input, { target: { value: "transfer me" } });
		await fireEvent.submit(input.closest("form")!);

		await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(""));
		expect(onSend).toHaveBeenCalledWith({
			type: "Text",
			body: { text: "transfer me" },
		});
	});

	it("retains composer and memory when send throws before transfer", async () => {
		const accountSession = activateAccountSession(1003);
		const onSend = vi.fn(() => Promise.reject(new Error("not accepted")));
		render(MessageComposer, {
			onSend,
			disabled: false,
			accountProfileId: 1003,
			conversationId: "conversation-c",
			accountSession,
		});
		const input = screen.getByPlaceholderText("Say something...");
		await fireEvent.input(input, { target: { value: "keep me" } });
		await fireEvent.submit(input.closest("form")!);

		await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
		expect((input as HTMLTextAreaElement).value).toBe("keep me");
		expect(
			navigationMemory.getDetailSession("conversation-c", accountSession)
				.draftText,
		).toBe("keep me");
	});

	it("does not clear when a callback resolves without accepted ownership", async () => {
		const accountSession = activateAccountSession(1004);
		const onSend = vi.fn(() => Promise.resolve(undefined));
		render(MessageComposer, {
			onSend: onSend as never,
			disabled: false,
			accountProfileId: 1004,
			conversationId: "conversation-d",
			accountSession,
		});
		const input = screen.getByPlaceholderText("Say something...");
		await fireEvent.input(input, { target: { value: "still mine" } });
		await fireEvent.submit(input.closest("form")!);

		await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
		expect((input as HTMLTextAreaElement).value).toBe("still mine");
	});
});
