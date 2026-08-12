import { fetchRest } from "$lib/api";
import { updateCachedGridProfile } from "$lib/app-data/grid-cache";
import type { Profile } from "$lib/model/users/profiles";
import { mergeProfileEditIntoCaches } from "./profiles";

export async function addFavoriteUser({
	profileId,
}: {
	profileId: Profile["profileId"];
}) {
	await fetchRest(`/v3/me/favorites/${profileId}`, {
		method: "POST",
	}).then((res) => res.assertOk());
	mergeProfileEditIntoCaches(profileId, { isFavorite: true });
	void updateCachedGridProfile(profileId, { isFavorite: true }).catch(
		(error: unknown) => console.error("Browse cache update failed", error),
	);
}

export async function removeFavoriteUser({
	profileId,
}: {
	profileId: Profile["profileId"];
}) {
	await fetchRest(`/v3/me/favorites/${profileId}`, {
		method: "DELETE",
	}).then((res) => res.assertOk());
	mergeProfileEditIntoCaches(profileId, { isFavorite: false });
	void updateCachedGridProfile(profileId, { isFavorite: false }).catch(
		(error: unknown) => console.error("Browse cache update failed", error),
	);
}
