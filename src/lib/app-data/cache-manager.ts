import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { clearAlbumPresets } from "$lib/albums/album-preset-store";
import {
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
} from "$lib/api/account-caches";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import {
	existsAppDataFile,
	readAppDataFile,
	removeAppDataFile,
	writeAppDataFileAtomic,
} from ".";
import {
	clearAlbumMediaCache,
	getAlbumMediaCacheStats,
	subscribeAlbumMediaCacheStats,
	trimAlbumMediaCache,
} from "./album-media-cache";
import { clearDirectMediaCache } from "./direct-media-cache";
import {
	clearShortVideoCache,
	getShortVideoCacheStats,
	subscribeShortVideoCacheStats,
} from "./short-video-cache";

export const cacheKindSchema = z.enum([
	"profile",
	"grid",
	"inbox",
	"conversation",
	"album",
	"migration",
	"taps",
	"views",
]);
export type CacheKind = z.infer<typeof cacheKindSchema>;

const manifestEntrySchema = z.object({
	accountId: z.number().int().nonnegative(),
	kind: cacheKindSchema,
	key: z.string(),
	path: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	lastAccessedAt: z.number().nonnegative(),
});

const cacheManifestSchema = z.object({
	version: z.literal(1).default(1),
	entries: z.record(z.string(), manifestEntrySchema).default({}),
});

type CacheManifest = z.infer<typeof cacheManifestSchema>;
export type CacheUsage = { limitBytes: number; usedBytes: number };

const MANIFEST_PATH = "cache-manifest.data";
const DEFAULT_LIMIT_MB = 100;
const MANIFEST_TOUCH_INTERVAL_FALLBACK_MS = 60 * 60 * 1_000;

let manifest: CacheManifest | null = null;
let queue: Promise<unknown> = Promise.resolve();
let limitMb = DEFAULT_LIMIT_MB;
let shortVideoCacheBytes = 0;
let albumMediaCacheBytes = 0;
const listeners = new Set<(usage: CacheUsage) => void>();

export function parseCacheManifest(value: unknown): CacheManifest {
	return cacheManifestSchema.parse(value);
}

function entryId(accountId: number, kind: CacheKind, key: string): string {
	return JSON.stringify([accountId, kind, key]);
}

function manifestTouchIntervalMs(): number {
	const configured =
		getDeveloperSettingsSnapshot().cacheManifestTouchIntervalMinutes;
	return Number.isFinite(configured) && configured > 0
		? configured * 60_000
		: MANIFEST_TOUCH_INTERVAL_FALLBACK_MS;
}

function hashKey(key: string): string {
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function entryPath(accountId: number, kind: CacheKind, key: string): string {
	return `cache-${accountId}-${kind}-${hashKey(key)}.data`;
}

async function loadManifest(): Promise<CacheManifest> {
	if (manifest) return manifest;
	if (!(await existsAppDataFile(MANIFEST_PATH))) {
		manifest = parseCacheManifest({});
		return manifest;
	}
	try {
		manifest = parseCacheManifest(decode(await readAppDataFile(MANIFEST_PATH)));
	} catch {
		console.error("Cache manifest hydration failed");
		manifest = parseCacheManifest({});
	}
	return manifest;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(task);
	queue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

function usageOf(value: CacheManifest): CacheUsage {
	return {
		limitBytes: limitMb * 1024 * 1024,
		usedBytes:
			albumMediaCacheBytes +
			shortVideoCacheBytes +
			Object.values(value.entries).reduce(
				(total, entry) => total + entry.sizeBytes,
				0,
			),
	};
}

function notify(value: CacheManifest): void {
	const usage = usageOf(value);
	for (const listener of listeners) listener(usage);
}

async function persistManifest(value: CacheManifest): Promise<void> {
	await writeAppDataFileAtomic(MANIFEST_PATH, encode(value));
	manifest = value;
	notify(value);
}

async function evictToLimit(value: CacheManifest): Promise<void> {
	let used = usageOf(value).usedBytes;
	const limit = limitMb * 1024 * 1024;
	if (used <= limit) return;
	for (const [id, entry] of Object.entries(value.entries).toSorted(
		([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt,
	)) {
		if (used <= limit) break;
		// Migration ledgers are correctness state, not disposable cache data.
		// They remain tiny and are removed only with their owning account/cache.
		if (entry.kind === "migration") continue;
		await removeAppDataFile(entry.path);
		delete value.entries[id];
		used -= entry.sizeBytes;
	}
}

export async function readCacheEntry<T>(
	accountId: number,
	kind: CacheKind,
	key: string,
	parse: (value: unknown) => T,
): Promise<T | null> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== accountId) return null;
	return await enqueue(async () => {
		if (!isAccountSessionCurrent(session)) return null;
		const value = await loadManifest();
		const id = entryId(accountId, kind, key);
		const entry = value.entries[id];
		if (!entry) return null;
		let parsed: T;
		try {
			parsed = parse(decode(await readAppDataFile(entry.path)));
		} catch {
			console.error("Cache entry hydration failed");
			await removeAppDataFile(entry.path);
			delete value.entries[id];
			await persistManifest(value);
			return null;
		}
		if (!isAccountSessionCurrent(session)) return null;
		const accessedAt = Date.now();
		if (accessedAt - entry.lastAccessedAt >= manifestTouchIntervalMs()) {
			const previousAccessedAt = entry.lastAccessedAt;
			entry.lastAccessedAt = accessedAt;
			try {
				await persistManifest(value);
			} catch (error) {
				entry.lastAccessedAt = previousAccessedAt;
				console.error("Cache manifest access-time update failed", error);
			}
		}
		return parsed;
	});
}

export async function listCacheEntries<T>(
	accountId: number,
	kind: CacheKind,
	parse: (value: unknown) => T,
): Promise<T[]> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== accountId) return [];
	return await enqueue(async () => {
		if (!isAccountSessionCurrent(session)) return [];
		const value = await loadManifest();
		const results: T[] = [];
		let manifestChanged = false;
		for (const [id, entry] of Object.entries(value.entries)) {
			if (entry.accountId !== accountId || entry.kind !== kind) continue;
			try {
				results.push(parse(decode(await readAppDataFile(entry.path))));
			} catch {
				console.error("Cache entry hydration failed");
				await removeAppDataFile(entry.path);
				delete value.entries[id];
				manifestChanged = true;
			}
		}
		if (manifestChanged) await persistManifest(value);
		return isAccountSessionCurrent(session) ? results : [];
	});
}

export async function listCacheEntryPage<T>(
	accountId: number,
	kind: CacheKind,
	parse: (value: unknown) => T,
	cursor: string | null = null,
	pageSize = 60,
): Promise<{
	items: Array<{ key: string; value: T }>;
	nextCursor: string | null;
}> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== accountId) return { items: [], nextCursor: null };
	return await enqueue(async () => {
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
		const value = await loadManifest();
		const entries = Object.entries(value.entries)
			.filter(
				([, entry]) => entry.accountId === accountId && entry.kind === kind,
			)
			.map(([id, entry]) => ({ id, entry }))
			.filter(({ entry }) => cursor === null || entry.key > cursor)
			.toSorted((left, right) => left.entry.key.localeCompare(right.entry.key))
			.slice(0, Math.min(60, Math.max(1, Math.trunc(pageSize))));
		const items: Array<{ key: string; value: T }> = [];
		let manifestChanged = false;
		for (const { id, entry } of entries) {
			try {
				items.push({
					key: entry.key,
					value: parse(decode(await readAppDataFile(entry.path))),
				});
			} catch {
				console.error("Cache entry hydration failed");
				await removeAppDataFile(entry.path);
				delete value.entries[id];
				manifestChanged = true;
			}
		}
		if (manifestChanged) await persistManifest(value);
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
		return {
			items,
			nextCursor:
				entries.length === Math.min(60, Math.max(1, Math.trunc(pageSize)))
					? (entries.at(-1)?.entry.key ?? null)
					: null,
		};
	});
}

export async function writeCacheEntry(
	accountId: number,
	kind: CacheKind,
	key: string,
	payload: unknown,
): Promise<void> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== accountId) return;
	await enqueue(async () => {
		if (!isAccountSessionCurrent(session)) return;
		const value = await loadManifest();
		const bytes = encode(payload);
		const path = entryPath(accountId, kind, key);
		await writeAppDataFileAtomic(path, bytes);
		if (!isAccountSessionCurrent(session)) {
			await removeAppDataFile(path);
			return;
		}
		value.entries[entryId(accountId, kind, key)] = {
			accountId,
			kind,
			key,
			path,
			sizeBytes: bytes.byteLength,
			lastAccessedAt: Date.now(),
		};
		await evictToLimit(value);
		await persistManifest(value);
	});
}

export async function removeCacheEntry(
	accountId: number,
	kind: CacheKind,
	key: string,
): Promise<void> {
	await enqueue(async () => {
		const value = await loadManifest();
		const id = entryId(accountId, kind, key);
		const entry = value.entries[id];
		if (!entry) return;
		await removeAppDataFile(entry.path);
		delete value.entries[id];
		await persistManifest(value);
	});
}

export async function removeAccountCache(accountId: number): Promise<void> {
	const results = await Promise.allSettled([
		clearAlbumPresets(accountId),
		clearAlbumMediaCache(accountId),
		clearDirectMediaCache(accountId),
		clearShortVideoCache(accountId),
		removeGenericAccountCache(accountId),
	]);
	const failures = results
		.filter((result) => result.status === "rejected")
		.map((result) => result.reason);
	if (failures.length > 0)
		throw new AggregateError(failures, "Account cache cleanup was incomplete");
}

export async function removeGenericAccountCache(
	accountId: number,
): Promise<void> {
	await enqueue(async () => {
		const value = await loadManifest();
		for (const [id, entry] of Object.entries(value.entries)) {
			if (entry.accountId !== accountId) continue;
			await removeAppDataFile(entry.path);
			delete value.entries[id];
		}
		await persistManifest(value);
	});
}

export async function clearAllCachedData(): Promise<void> {
	// Saved album sets are durable user data, not cache, and intentionally do
	// not participate in the generic "clear cached data" action.
	await clearAlbumMediaCache();
	await clearDirectMediaCache();
	await clearShortVideoCache();
	await enqueue(async () => {
		const value = await loadManifest();
		for (const entry of Object.values(value.entries)) {
			await removeAppDataFile(entry.path);
		}
		await persistManifest(parseCacheManifest({}));
	});
}

export async function setCacheLimitMb(value: number): Promise<void> {
	limitMb = Math.min(1000, Math.max(10, Math.round(value / 10) * 10));
	await trimAlbumMediaCache(limitMb * 1024 * 1024);
	await enqueue(async () => {
		const current = await loadManifest();
		await evictToLimit(current);
		await persistManifest(current);
	});
}

export async function getCacheUsage(): Promise<CacheUsage> {
	albumMediaCacheBytes = (await getAlbumMediaCacheStats()).byteLength;
	shortVideoCacheBytes = (await getShortVideoCacheStats()).byteLength;
	return usageOf(await loadManifest());
}

export function subscribeCacheUsage(
	listener: (usage: CacheUsage) => void,
	onError: (error: unknown) => void = () =>
		console.error("Cache usage hydration failed"),
): () => void {
	listeners.add(listener);
	void getCacheUsage().then(listener).catch(onError);
	return () => listeners.delete(listener);
}

export function clearCacheManagerMemory(): void {
	manifest = null;
}

subscribeShortVideoCacheStats((stats) => {
	shortVideoCacheBytes = stats.byteLength;
	if (manifest) notify(manifest);
});

subscribeAlbumMediaCacheStats((stats) => {
	albumMediaCacheBytes = stats.byteLength;
	if (manifest) notify(manifest);
});
