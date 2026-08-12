import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getFavoriteNoteMock, setFavoriteNoteMock } = vi.hoisted(() => ({
	getFavoriteNoteMock: vi.fn(),
	setFavoriteNoteMock: vi.fn(),
}));

vi.mock("$lib/app-data/favorite-notes", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/app-data/favorite-notes")>()),
	getFavoriteNote: getFavoriteNoteMock,
	setFavoriteNote: setFavoriteNoteMock,
}));
vi.mock("$lib/api/error", () => ({ showErrorToast: vi.fn() }));

import FavoriteNote from "./FavoriteNote.svelte";

describe("FavoriteNote load safety", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("cannot overwrite a note after load failure and recovers through retry", async () => {
		getFavoriteNoteMock
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValueOnce("Existing private note");
		render(FavoriteNote, {
			accountProfileId: 7,
			profileId: 42,
			isFavorite: true,
		});

		const note = screen.getByLabelText<HTMLTextAreaElement>(
			"Private note about this favorite",
		);
		const retry = await screen.findByRole("button", {
			name: "Retry loading note",
		});
		expect(note.disabled).toBe(true);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Save note" })
				.disabled,
		).toBe(true);
		expect(setFavoriteNoteMock).not.toHaveBeenCalled();

		await fireEvent.click(retry);
		await waitFor(() => expect(note.value).toBe("Existing private note"));
		expect(note.disabled).toBe(false);
		expect(setFavoriteNoteMock).not.toHaveBeenCalled();
	});
});
