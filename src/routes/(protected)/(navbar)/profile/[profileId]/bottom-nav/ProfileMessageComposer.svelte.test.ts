// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProfileMessageComposer from "./ProfileMessageComposer.svelte";

const session = vi.hoisted(() => ({
	send: vi.fn(() => Promise.resolve({ kind: "ack" })),
}));
vi.mock("$lib/chat/direct-message-session", () => ({
	getDirectMessageSession: () => session,
}));
vi.mock("$lib/app-data/saved-phrases", () => ({
	filterSavedPhrases: (phrases: unknown[]) => phrases,
	listSavedPhrases: vi.fn(() =>
		Promise.resolve([{ id: "saved", text: "Saved hello" }]),
	),
	subscribeSavedPhrases: () => () => {},
}));

afterEach(() => {
	cleanup();
	session.send.mockClear();
});

describe("ProfileMessageComposer", () => {
	it("types and sends in place through the shared session", async () => {
		const view = render(ProfileMessageComposer, {
			ourProfileId: 7,
			profileId: 42,
		});
		const input = view.getByRole("textbox", { name: "Message this profile" });
		await fireEvent.input(input, { target: { value: "Hello" } });
		expect(window.location.pathname).not.toContain("/chat/");

		await fireEvent.click(view.getByRole("button", { name: "Send message" }));
		await waitFor(() => expect(session.send).toHaveBeenCalledOnce());
		expect((input as HTMLTextAreaElement).value).toBe("");
	});

	it("inserts a saved phrase without navigating", async () => {
		const view = render(ProfileMessageComposer, {
			ourProfileId: 7,
			profileId: 42,
		});
		await fireEvent.click(
			await view.findByRole("button", { name: "Saved hello" }),
		);
		expect(
			(
				view.getByRole("textbox", {
					name: "Message this profile",
				}) as HTMLTextAreaElement
			).value,
		).toBe("Saved hello");
	});
});
