import z from "zod";

export const favoriteNoteSchema = z.object({
	notes: z.string(),
	phoneNumber: z.string(),
});

export type FavoriteNote = z.infer<typeof favoriteNoteSchema>;
