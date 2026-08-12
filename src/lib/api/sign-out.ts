import { goto } from "$app/navigation";

import { callMethod } from "$lib/api";
import { invalidateAccountSession } from "$lib/api/account-caches";
import {
	removeAccountCache,
	removeGenericAccountCache,
} from "$lib/app-data/cache-manager";
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
	if (accountId !== null) {
		try {
			await callMethod("notification_clear_account", { accountId });
		} catch (error) {
			console.error(error);
		}
	}

	await removeLocalAccountCache(accountId);

	try {
		await callMethod("logout");
	} catch (error) {
		console.error(error);
	}

	await finishLocalAccountTeardown(accountId, false);

	await goto("/auth/sign-in");
}

export async function clearLocalAccountState(): Promise<boolean> {
	const accountId = beginLocalAccountTeardown();
	const genericCacheComplete = await removeLocalGenericCache(accountId);
	return (
		(await finishLocalAccountTeardown(accountId, false)) && genericCacheComplete
	);
}

async function removeLocalGenericCache(
	accountId: number | null,
): Promise<boolean> {
	try {
		if (accountId !== null) await removeGenericAccountCache(accountId);
		return true;
	} catch (error) {
		console.error(error);
		return false;
	}
}

function beginLocalAccountTeardown(): number | null {
	invalidateProfileLocationMutations();
	const profileCacheAccount = getProfileCacheAccount();
	const previousSession = invalidateAccountSession();
	return previousSession.accountId ?? profileCacheAccount;
}

async function finishLocalAccountTeardown(
	accountId: number | null,
	removeCache = true,
): Promise<boolean> {
	let complete = removeCache ? await removeLocalAccountCache(accountId) : true;
	try {
		await clearAccountPreferences();
	} catch (error) {
		console.error(error);
		complete = false;
	}
	clearInboxMarkers();
	return complete;
}

async function removeLocalAccountCache(
	accountId: number | null,
): Promise<boolean> {
	try {
		if (accountId !== null) await removeAccountCache(accountId);
		return true;
	} catch (error) {
		console.error(error);
		return false;
	}
}

function clearInboxMarkers(): void {
	if (typeof localStorage === "undefined") return;
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith(INBOX_LAST_VIEWED_PREFIX)) localStorage.removeItem(key);
	}
}
