import { redirect } from "@sveltejs/kit";

import { callMethod } from "$lib/api";
import { activateAccountSession } from "$lib/api/account-caches";
import { setCacheLimitMb } from "$lib/app-data/cache-manager";
import { migrateBeta4ConversationCaches } from "$lib/app-data/chat-cache";
import {
	getCacheSizeMbSnapshot,
	getRetainSharedChatMediaSnapshot,
	hydratePreferences,
} from "$lib/app-data/preferences.svelte";
import { setProfileCacheAccount } from "$lib/app-data/profile-cache";
import {
	captureSharedMediaRetentionAuthorization,
	synchronizeSharedMediaRetentionState,
} from "$lib/app-data/shared-media-retention-preference";
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
	synchronizeSharedMediaRetentionState(getRetainSharedChatMediaSnapshot());
	try {
		await migrateBeta4ConversationCaches(profileId, {
			retentionAuthorization: captureSharedMediaRetentionAuthorization(),
		});
	} catch {
		console.error("Beta-5 conversation cache migration was incomplete");
	}
	try {
		await setCacheLimitMb(getCacheSizeMbSnapshot());
	} catch (error) {
		console.error("Cache initialization failed", error);
	}
	return { ourProfileId: profileId };
	// TODO: consider typesafe context?
};
