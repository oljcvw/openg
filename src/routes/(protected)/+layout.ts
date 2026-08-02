import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import { activateAccountSession } from "$lib/api/account-caches";
import { setCacheLimitMb } from "$lib/app-data/cache-manager";
import {
	getCacheSizeMbSnapshot,
	hydratePreferences,
} from "$lib/app-data/preferences.svelte";
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
	activateAccountSession(profileId);
	setProfileCacheAccount(profileId);
	await hydratePreferences();
	try {
		await setCacheLimitMb(getCacheSizeMbSnapshot());
	} catch (error) {
		console.error("Cache initialization failed", error);
	}
	return { ourProfileId: profileId };
	// TODO: consider typesafe context?
};
