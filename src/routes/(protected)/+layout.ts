import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import { setProfileCacheAccount } from "$lib/app-data/profile-cache";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async () => {
	const profileId = await callMethod("auth_state").catch((error) => {
		console.error(error);
		return null;
	});
	if (profileId === null) {
		redirect(303, "/auth/sign-in");
	}
	setProfileCacheAccount(profileId);
	return { ourProfileId: profileId };
	// TODO: consider typesafe context?
};
