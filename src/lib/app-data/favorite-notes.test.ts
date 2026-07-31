import { describe, expect, it } from "vitest";

import {
	FAVORITE_NOTE_MAX_LENGTH,
	favoriteNoteLength,
	favoriteNoteSchema,
	parseFavoriteNotes,
} from "$lib/app-data/favorite-notes";

describe("favorite notes", () => {
	it("keeps notes isolated by account and profile", () => {
		const notes = parseFavoriteNotes({
			version: 1,
			accounts: {
				"100": { "200": "Met at the park" },
				"101": { "200": "Different account" },
			},
		});

		expect(notes.accounts["100"]?.["200"]).toBe("Met at the park");
		expect(notes.accounts["101"]?.["200"]).toBe("Different account");
	});

	it("accepts 280 Unicode characters and rejects 281", () => {
		const valid = "🙂".repeat(FAVORITE_NOTE_MAX_LENGTH);
		const invalid = `${valid}🙂`;

		expect(favoriteNoteLength(valid)).toBe(FAVORITE_NOTE_MAX_LENGTH);
		expect(favoriteNoteSchema.safeParse(valid).success).toBe(true);
		expect(favoriteNoteSchema.safeParse(invalid).success).toBe(false);
	});

	it("adds defaults for a new data file", () => {
		expect(parseFavoriteNotes({})).toEqual({
			version: 1,
			accounts: {},
		});
	});
});
