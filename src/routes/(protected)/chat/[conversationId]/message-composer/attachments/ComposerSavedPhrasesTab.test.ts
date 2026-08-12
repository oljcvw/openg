import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listSavedPhrasesMock, subscribeSavedPhrasesMock } = vi.hoisted(() => ({
	listSavedPhrasesMock: vi.fn(),
	subscribeSavedPhrasesMock: vi.fn(),
}));

vi.mock("$lib/app-data/saved-phrases", () => ({
	addSavedPhrase: vi.fn(),
	clearSavedPhrases: vi.fn(),
	deleteSavedPhrase: vi.fn(),
	DuplicateSavedPhraseError: class DuplicateSavedPhraseError extends Error {},
	listSavedPhrases: listSavedPhrasesMock,
	moveSavedPhrase: vi.fn(),
	subscribeSavedPhrases: subscribeSavedPhrasesMock,
	updateSavedPhrase: vi.fn(),
}));

import Harness from "./ComposerSavedPhrasesTab.test.svelte";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe("ComposerSavedPhrasesTab account isolation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		subscribeSavedPhrasesMock.mockReturnValue(() => {});
	});

	afterEach(cleanup);

	it("discards a saved-phrase load that resolves after the account changes", async () => {
		const accountOne = deferred<Array<{ id: string; text: string }>>();
		const accountTwo = deferred<Array<{ id: string; text: string }>>();
		listSavedPhrasesMock.mockImplementation((accountProfileId: number) =>
			accountProfileId === 1 ? accountOne.promise : accountTwo.promise,
		);
		const rendered = render(Harness, { accountProfileId: 1 });

		await waitFor(() => expect(listSavedPhrasesMock).toHaveBeenCalledWith(1));
		await rendered.rerender({ accountProfileId: 2 });
		await waitFor(() => expect(listSavedPhrasesMock).toHaveBeenCalledWith(2));

		accountOne.resolve([
			{ id: "00000000-0000-4000-8000-000000000001", text: "Account one" },
		]);
		await Promise.resolve();
		expect(screen.queryByText("Account one")).toBeNull();

		accountTwo.resolve([
			{ id: "00000000-0000-4000-8000-000000000002", text: "Account two" },
		]);
		await waitFor(() => expect(screen.getByText("Account two")).toBeTruthy());
		expect(screen.queryByText("Account one")).toBeNull();
	});
});
