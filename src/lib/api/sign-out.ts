import { goto } from "$app/navigation";

import { callMethod } from "$lib/api";
import { clearAccountCaches } from "$lib/api/account-caches";
import { deleteActiveAccountGridCache } from "$lib/app-data/grid-cache";
import { clearAccountPreferences } from "$lib/app-data/preferences.svelte";
import { deleteActiveAccountProfileCache } from "$lib/app-data/profile-cache";
import { invalidateProfileLocationMutations } from "$lib/location/profile-location";

const INBOX_LAST_VIEWED_PREFIX = "chat:inbox-last-viewed:";

export async function signOut(): Promise<void> {
	try {
		await callMethod("notification_cancel");
	} catch (error) {
		console.error(error);
	}

	try {
		await callMethod("logout");
	} catch (error) {
		console.error(error);
	}

	await clearLocalAccountState();

	await goto("/auth/sign-in");
}

export async function clearLocalAccountState(): Promise<void> {
	invalidateProfileLocationMutations();
	try {
		await Promise.all([
			deleteActiveAccountGridCache(),
			deleteActiveAccountProfileCache(),
		]);
	} catch (error) {
		console.error(error);
	}
	try {
		await clearAccountPreferences();
	} catch (error) {
		console.error(error);
	}
	clearInboxMarkers();
	clearAccountCaches();
}

function clearInboxMarkers(): void {
	if (typeof localStorage === "undefined") return;
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith(INBOX_LAST_VIEWED_PREFIX)) localStorage.removeItem(key);
	}
}
