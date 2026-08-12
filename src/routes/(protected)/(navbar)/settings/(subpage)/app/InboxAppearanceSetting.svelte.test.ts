// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import InboxAppearanceSetting from "./InboxAppearanceSetting.svelte";

const preferences = vi.hoisted(() => ({
	getPreferences: vi.fn(() =>
		Promise.resolve({
			inboxLayoutMode: "adaptive" as const,
			inboxRowDensity: "comfortable" as const,
		}),
	),
	setPreferences: vi.fn(() => Promise.resolve()),
}));

vi.mock("$lib/app-data/preferences.svelte", () => ({
	getInboxLayoutModeSnapshot: () => "adaptive",
	getInboxRowDensitySnapshot: () => "comfortable",
	getPreferences: preferences.getPreferences,
	setPreferences: preferences.setPreferences,
}));

afterEach(() => {
	cleanup();
	preferences.getPreferences.mockClear();
	preferences.setPreferences.mockClear();
});

describe("Inbox appearance setting", () => {
	it("previews and persists layout and row-density choices", async () => {
		render(InboxAppearanceSetting);
		const stacked = screen.getByRole<HTMLButtonElement>("radio", {
			name: "Stacked",
		});

		await waitFor(() => expect(stacked.disabled).toBe(false));
		await fireEvent.click(stacked);
		await fireEvent.click(screen.getByRole("radio", { name: "Roomy" }));

		expect(preferences.setPreferences).toHaveBeenNthCalledWith(1, {
			inboxLayoutMode: "stacked",
		});
		expect(preferences.setPreferences).toHaveBeenNthCalledWith(2, {
			inboxRowDensity: "roomy",
		});
	});
});
