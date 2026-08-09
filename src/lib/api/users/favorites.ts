import { fetchRest } from "$lib/api/transport";
import { type FavoriteNote, favoriteNoteSchema } from "$lib/model/favorites";
import type { Profile } from "$lib/model/users/profiles";

export async function addFavoriteUser({
	profileId,
}: {
	profileId: Profile["profileId"];
}) {
	await fetchRest(`/v3/me/favorites/${profileId}`, { method: "POST" }).then(
		(res) => res.assertOk(),
	);
}

export async function removeFavoriteUser({
	profileId,
}: {
	profileId: Profile["profileId"];
}) {
	await fetchRest(`/v3/me/favorites/${profileId}`, { method: "DELETE" }).then(
		(res) => res.assertOk(),
	);
}

export async function getFavoriteUserNote(
	profileId: Profile["profileId"],
): Promise<FavoriteNote> {
	return await fetchRest(`/v1/favorites/notes/${profileId}`).then((res) =>
		res.jsonParsed(favoriteNoteSchema),
	);
}

export async function updateFavoriteUserNote(
	profileId: Profile["profileId"],
	note: FavoriteNote,
): Promise<void> {
	await fetchRest(`/v1/favorites/notes/${profileId}`, {
		method: "PUT",
		body: note,
	}).then((res) => res.assertOk());
}
