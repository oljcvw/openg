import { goto } from "$app/navigation";

import { callMethod } from "$lib/api";
import { invalidateAccountSession } from "$lib/api/account-caches";
import { removeAccountCache } from "$lib/app-data/cache-manager";
import { clearAccountPreferences } from "$lib/app-data/preferences.svelte";
import { getProfileCacheAccount } from "$lib/app-data/profile-cache";
import { invalidateProfileLocationMutations } from "$lib/location/profile-location";

const INBOX_LAST_VIEWED_PREFIX = "chat:inbox-last-viewed:";

export async function signOut(): Promise<void> {
	const accountId = beginLocalAccountTeardown();
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

	await finishLocalAccountTeardown(accountId);

	await goto("/auth/sign-in");
}

export async function clearLocalAccountState(): Promise<void> {
	const accountId = beginLocalAccountTeardown();
	await finishLocalAccountTeardown(accountId);
}

function beginLocalAccountTeardown(): number | null {
	invalidateProfileLocationMutations();
	const profileCacheAccount = getProfileCacheAccount();
	const previousSession = invalidateAccountSession();
	return previousSession.accountId ?? profileCacheAccount;
}

async function finishLocalAccountTeardown(
	accountId: number | null,
): Promise<void> {
	try {
		if (accountId !== null) await removeAccountCache(accountId);
	} catch (error) {
		console.error(error);
	}
	try {
		await clearAccountPreferences();
	} catch (error) {
		console.error(error);
	}
	clearInboxMarkers();
}

function clearInboxMarkers(): void {
	if (typeof localStorage === "undefined") return;
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith(INBOX_LAST_VIEWED_PREFIX)) localStorage.removeItem(key);
	}
}
