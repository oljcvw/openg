import { clearDirectMediaCache } from "$lib/app-data/direct-media-cache";
import { setPreferences } from "$lib/app-data/preferences.svelte";
import { clearShortVideoCache } from "$lib/app-data/short-video-cache";

export type SharedMediaRetentionAuthorization = Readonly<{
	generation: number;
}>;

let retentionEnabled = true;
let retentionGeneration = 0;
let activeRetentionWrites = 0;
const retentionWriteWaiters = new Set<() => void>();

/** Align runtime authorization with the hydrated preference. */
export function synchronizeSharedMediaRetentionState(enabled: boolean): void {
	if (retentionEnabled === enabled) return;
	retentionEnabled = enabled;
	retentionGeneration += 1;
}

export function captureSharedMediaRetentionAuthorization(): SharedMediaRetentionAuthorization | null {
	return retentionEnabled ? { generation: retentionGeneration } : null;
}

export function isSharedMediaRetentionAuthorizationCurrent(
	authorization: SharedMediaRetentionAuthorization,
): boolean {
	return retentionEnabled && authorization.generation === retentionGeneration;
}

/**
 * Register one native retention write. Disable waits for all registered writes
 * before clearing, so a suspended write cannot repopulate the cleared cache.
 */
export function beginSharedMediaRetentionWrite(
	authorization: SharedMediaRetentionAuthorization,
): (() => void) | null {
	if (!isSharedMediaRetentionAuthorizationCurrent(authorization)) return null;
	activeRetentionWrites += 1;
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		activeRetentionWrites -= 1;
		if (activeRetentionWrites !== 0) return;
		for (const resolve of retentionWriteWaiters) resolve();
		retentionWriteWaiters.clear();
	};
}

function waitForSharedMediaRetentionWrites(): Promise<void> {
	if (activeRetentionWrites === 0) return Promise.resolve();
	return new Promise((resolve) => retentionWriteWaiters.add(resolve));
}

/** Persist the global preference before applying its global privacy cleanup. */
export async function setSharedMediaRetentionPreference(
	enabled: boolean,
): Promise<void> {
	if (enabled) {
		await setPreferences({ retainSharedChatMedia: true });
		synchronizeSharedMediaRetentionState(true);
		return;
	}

	await setPreferences({ retainSharedChatMedia: false });
	synchronizeSharedMediaRetentionState(false);
	await waitForSharedMediaRetentionWrites();
	await Promise.all([clearDirectMediaCache(), clearShortVideoCache()]);
}
