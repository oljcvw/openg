import {
	getAccountSessionSnapshot,
	registerAccountCache,
} from "$lib/api/account-caches";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { AccountTtlLru } from "$lib/util/account-ttl-lru";
import { now } from "$lib/util/clock";

export type ProfileMemoryRecord = {
	full?: unknown;
	browse?: unknown;
	me?: unknown;
	freshnessHint?: number;
};

const cache = new AccountTtlLru<ProfileMemoryRecord>({
	capacity: () => getDeveloperSettingsSnapshot().profileCacheMaxEntries,
	ttlMs: 60_000,
	now,
});

function scoped(): typeof cache {
	const session = getAccountSessionSnapshot();
	cache.setAccount(session.accountId, session.generation);
	return cache;
}

export function getProfileMemoryRecord(
	id: number | string,
): ProfileMemoryRecord | null {
	return scoped().get(id);
}

export function mergeProfileMemoryRecord(
	id: number | string,
	patch: ProfileMemoryRecord,
	updatedAt = now(),
): void {
	const current = scoped().get(id) ?? {};
	scoped().set(id, { ...current, ...patch }, updatedAt);
}

export function deleteProfileMemoryRecord(id: number | string): void {
	scoped().delete(id);
}

export function clearProfileMemoryCache(): void {
	cache.clear();
}

registerAccountCache(clearProfileMemoryCache);
