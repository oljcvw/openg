import { registerAccountCache } from "$lib/api/account-caches";
import {
	type DirectMediaHistoryEntry,
	importLegacyDirectMedia,
	setDirectMediaCacheScope,
	storeDirectMedia,
	upsertDirectMediaHistoryBatch,
} from "$lib/app-data/direct-media-cache";
import {
	getDeveloperSettingsSnapshot,
	getRetainSharedChatMediaSnapshot,
} from "$lib/app-data/preferences.svelte";
import type { SharedMediaEntry } from "$lib/chat/shared-media";

const queue: Array<{
	entry: SharedMediaEntry;
	resolve: (url: string | null) => void;
}> = [];
const queued = new Set<string>();
let active = 0;
let visibleScope: string | null = null;
let scopeGeneration = 0;
let activeScopeToken: string | null = null;
let scopeReady: Promise<void> = Promise.resolve();

function key(entry: SharedMediaEntry): string {
	return [
		entry.accountProfileId,
		entry.conversationId,
		entry.peerProfileId,
		entry.messageId,
		entry.mediaId,
	].join(":");
}

function scopeKey(entry: SharedMediaEntry): string {
	return [
		entry.accountProfileId,
		entry.conversationId,
		entry.peerProfileId,
	].join(":");
}

function historyInput(entry: SharedMediaEntry) {
	return {
		accountProfileId: entry.accountProfileId,
		conversationId: entry.conversationId,
		peerProfileId: entry.peerProfileId,
		messageId: entry.messageId,
		mediaId: entry.mediaId,
		kind: entry.kind,
		messageType: entry.messageType,
		sentAt: entry.sentAt,
		remoteAvailability: entry.remoteAvailability,
	};
}

export function queueVisibleDirectMedia(
	entry: SharedMediaEntry,
): Promise<string | null> {
	if (
		entry.consumptive ||
		entry.remoteUrl === null ||
		entry.remoteAvailability !== "available" ||
		!getRetainSharedChatMediaSnapshot()
	)
		return Promise.resolve(null);
	const expectedScope = [
		entry.accountProfileId,
		entry.conversationId,
		entry.peerProfileId,
	].join(":");
	if (visibleScope !== null && visibleScope !== expectedScope)
		return Promise.resolve(null);
	const entryKey = key(entry);
	if (queued.has(entryKey)) return Promise.resolve(null);
	queued.add(entryKey);
	return new Promise((resolve) => {
		queue.push({ entry, resolve });
		void drain();
	});
}

function drain(): void {
	const concurrency =
		getDeveloperSettingsSnapshot().directMediaCacheConcurrency;
	while (active < concurrency && queue.length > 0) {
		const queuedEntry = queue.shift();
		if (!queuedEntry) return;
		const { entry, resolve } = queuedEntry;
		const generation = scopeGeneration;
		const scopeToken = activeScopeToken;
		active += 1;
		void retain(entry, generation, scopeToken)
			.then(resolve)
			.catch(() => {
				// The native boundary reports only a bounded error kind. Tiles remain
				// remotely viewable, so cache failure is deliberately nonfatal.
				resolve(null);
			})
			.finally(() => {
				active -= 1;
				queued.delete(key(entry));
				void drain();
			});
	}
}

async function retain(
	entry: SharedMediaEntry,
	generation: number,
	scopeToken: string | null,
): Promise<string | null> {
	if (!getRetainSharedChatMediaSnapshot() || entry.remoteUrl === null)
		return null;
	if (generation !== scopeGeneration || scopeToken === null) return null;
	await scopeReady;
	if (generation !== scopeGeneration || scopeToken !== activeScopeToken)
		return null;
	await upsertDirectMediaHistoryBatch([historyInput(entry)]);
	if (generation !== scopeGeneration) return null;
	const settings = getDeveloperSettingsSnapshot();
	const stored = await storeDirectMedia({
		...historyInput(entry),
		sourceUrl: entry.remoteUrl,
		contentType: entry.kind === "image" ? "image/*" : "video/*",
		maximumBytes: settings.directMediaCacheMb * 1024 * 1024,
		scopeToken,
	});
	if (generation !== scopeGeneration || scopeToken !== activeScopeToken)
		return null;
	return stored?.protocolUrl ?? null;
}

/** Persist a URL returned by the one authorized consumptive request. */
export async function retainAuthorizedDirectMedia(
	entry: SharedMediaEntry,
	contentType: string,
): Promise<string | null> {
	if (!getRetainSharedChatMediaSnapshot()) return null;
	const expectedScope = scopeKey(entry);
	if (visibleScope !== expectedScope) return null;
	const generation = scopeGeneration;
	const scopeToken = activeScopeToken;
	if (scopeToken === null) return null;
	await scopeReady;
	if (
		generation !== scopeGeneration ||
		scopeToken !== activeScopeToken ||
		visibleScope !== expectedScope
	)
		return null;
	const settings = getDeveloperSettingsSnapshot();
	const stored = await storeDirectMedia({
		...historyInput(entry),
		sourceUrl: entry.remoteUrl ?? "",
		contentType,
		maximumBytes: settings.directMediaCacheMb * 1024 * 1024,
		scopeToken,
	});
	if (
		generation !== scopeGeneration ||
		scopeToken !== activeScopeToken ||
		visibleScope !== expectedScope
	)
		return null;
	return stored?.protocolUrl ?? null;
}

/** Import one validated beta-4 Android cache entry without a network request. */
export async function importLegacyRetainedDirectMedia(
	entry: SharedMediaEntry,
	contentType: string,
	dataBase64: string,
	byteLength: number,
): Promise<string | null> {
	if (!getRetainSharedChatMediaSnapshot()) return null;
	const expectedScope = scopeKey(entry);
	if (visibleScope !== expectedScope) return null;
	const generation = scopeGeneration;
	const scopeToken = activeScopeToken;
	if (scopeToken === null) return null;
	await scopeReady;
	if (
		generation !== scopeGeneration ||
		scopeToken !== activeScopeToken ||
		visibleScope !== expectedScope
	)
		return null;
	const maximumBytes =
		getDeveloperSettingsSnapshot().directMediaCacheMb * 1024 * 1024;
	if (
		!Number.isSafeInteger(byteLength) ||
		byteLength <= 0 ||
		byteLength > maximumBytes
	)
		return null;
	const stored = await importLegacyDirectMedia({
		...historyInput(entry),
		dataBase64,
		contentType,
		maximumBytes,
		scopeToken,
	});
	if (
		generation !== scopeGeneration ||
		scopeToken !== activeScopeToken ||
		visibleScope !== expectedScope
	)
		return null;
	return stored?.protocolUrl ?? null;
}

export function toSharedMediaEntry(
	entry: DirectMediaHistoryEntry,
): SharedMediaEntry {
	return {
		accountProfileId: entry.accountProfileId,
		conversationId: entry.conversationId,
		peerProfileId: entry.peerProfileId,
		messageId: entry.messageId,
		mediaId: entry.mediaId,
		kind: entry.kind,
		messageType: entry.messageType,
		sentAt: entry.sentAt,
		remoteAvailability: entry.remoteAvailability,
		cacheAvailability: entry.cacheAvailability,
		cacheToken: entry.cacheToken,
		consumptive:
			entry.messageType === "ExpiringImage" ||
			entry.messageType === "PrivateVideo" ||
			entry.messageType === "Video",
		remoteUrl: entry.protocolUrl,
	};
}

export function clearDirectMediaRetentionQueue(): void {
	const previousAccount = visibleScope?.split(":", 1)[0];
	visibleScope = null;
	activeScopeToken = null;
	for (const item of queue) item.resolve(null);
	queue.length = 0;
	queued.clear();
	scopeGeneration += 1;
	if (previousAccount)
		scopeReady = setDirectMediaCacheScope(Number(previousAccount), null).catch(
			() => {},
		);
}

export function setDirectMediaRetentionScope(
	scope: {
		accountProfileId: number;
		conversationId: string;
		peerProfileId: number;
	} | null,
): void {
	const next = scope
		? [scope.accountProfileId, scope.conversationId, scope.peerProfileId].join(
				":",
			)
		: null;
	if (next === visibleScope) return;
	const previousAccount = visibleScope?.split(":", 1)[0];
	for (const item of queue) item.resolve(null);
	queue.length = 0;
	queued.clear();
	scopeGeneration += 1;
	visibleScope = next;
	activeScopeToken = scope ? crypto.randomUUID() : null;
	const accountProfileId =
		scope?.accountProfileId ??
		(previousAccount ? Number(previousAccount) : null);
	scopeReady =
		accountProfileId === null
			? Promise.resolve()
			: setDirectMediaCacheScope(
					accountProfileId,
					activeScopeToken,
					scope?.conversationId ?? null,
					scope?.peerProfileId ?? null,
				).catch(() => {
					// Store calls remain fail-closed because native rejects an unknown token.
				});
}

registerAccountCache(clearDirectMediaRetentionQueue);
