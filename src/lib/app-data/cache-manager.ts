import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import {
	existsAppDataFile,
	readAppDataFile,
	removeAppDataFile,
	writeAppDataFileAtomic,
} from ".";

export const cacheKindSchema = z.enum([
	"profile",
	"grid",
	"inbox",
	"conversation",
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

let manifest: CacheManifest | null = null;
let queue: Promise<unknown> = Promise.resolve();
let limitMb = DEFAULT_LIMIT_MB;
const listeners = new Set<(usage: CacheUsage) => void>();

export function parseCacheManifest(value: unknown): CacheManifest {
	return cacheManifestSchema.parse(value);
}

function entryId(accountId: number, kind: CacheKind, key: string): string {
	return JSON.stringify([accountId, kind, key]);
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
	} catch (error) {
		console.error("Cache manifest hydration failed", error);
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
		usedBytes: Object.values(value.entries).reduce(
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
	for (const [id, entry] of Object.entries(value.entries).toSorted(
		([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt,
	)) {
		if (used <= limit) break;
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
	return await enqueue(async () => {
		const value = await loadManifest();
		const id = entryId(accountId, kind, key);
		const entry = value.entries[id];
		if (!entry) return null;
		try {
			const parsed = parse(decode(await readAppDataFile(entry.path)));
			entry.lastAccessedAt = Date.now();
			await persistManifest(value);
			return parsed;
		} catch (error) {
			console.error("Cache entry hydration failed", error);
			await removeAppDataFile(entry.path);
			delete value.entries[id];
			await persistManifest(value);
			return null;
		}
	});
}

export async function writeCacheEntry(
	accountId: number,
	kind: CacheKind,
	key: string,
	payload: unknown,
): Promise<void> {
	await enqueue(async () => {
		const value = await loadManifest();
		const bytes = encode(payload);
		const path = entryPath(accountId, kind, key);
		await writeAppDataFileAtomic(path, bytes);
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
	await enqueue(async () => {
		const current = await loadManifest();
		await evictToLimit(current);
		await persistManifest(current);
	});
}

export async function getCacheUsage(): Promise<CacheUsage> {
	return usageOf(await loadManifest());
}

export function subscribeCacheUsage(
	listener: (usage: CacheUsage) => void,
): () => void {
	listeners.add(listener);
	void getCacheUsage().then(listener);
	return () => listeners.delete(listener);
}

export function clearCacheManagerMemory(): void {
	manifest = null;
}
