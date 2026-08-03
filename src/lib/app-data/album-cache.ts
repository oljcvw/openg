import z from "zod";

import { ApiError } from "$lib/api";
import {
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
	registerAccountCache,
} from "$lib/api/account-caches";
import {
	type AlbumContentResponse,
	albumContentResponseSchema,
	getAlbumContent,
} from "$lib/api/messaging/albums";
import {
	getCacheSizeMbSnapshot,
	getDeveloperSettingsSnapshot,
} from "$lib/app-data/preferences.svelte";
import { albumContentSchema } from "$lib/model/messaging/albums";
import { lookupAlbumMedia, storeAlbumMedia } from "./album-media-cache";
import {
	listCacheEntries,
	readCacheEntry,
	writeCacheEntry,
} from "./cache-manager";

const albumAccessSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("active"), validatedAt: z.number().int() }),
	z.object({
		status: z.literal("unavailable"),
		reason: z.enum(["revoked_or_removed", "expired", "views_exhausted"]),
		detectedAt: z.number().int(),
	}),
	z.object({
		status: z.literal("unknown"),
		lastValidatedAt: z.number().int().nullable(),
	}),
]);

const cachedMediaSchema = z.object({
	contentId: z.number().int(),
	contentType: z.string(),
	byteLength: z.number().int().nonnegative(),
	token: z.string().min(1),
});

const cachedAlbumMetadataSchema = albumContentResponseSchema
	.omit({ content: true })
	.extend({
		content: z.array(
			albumContentSchema
				.omit({ coverUrl: true, thumbUrl: true, url: true })
				.extend({ remainingViews: z.int().optional() }),
		),
	});

export const cachedAlbumRecordSchema = z.object({
	version: z.literal(1),
	albumId: z.number().int(),
	ownerProfileId: z.number().int().nullable(),
	expirationType: z.string().nullable(),
	expiresAt: z.number().int().nullable(),
	access: albumAccessSchema,
	album: cachedAlbumMetadataSchema,
	media: z.array(cachedMediaSchema),
	lastAccessedAt: z.number().int(),
});

export type CachedAlbumRecord = z.infer<typeof cachedAlbumRecordSchema>;
export type AlbumAccess = CachedAlbumRecord["access"];

export type AlbumDiscovery = {
	albumId: number;
	ownerProfileId: number | null;
	expirationType?: string | null;
	expiresAt?: number | null;
	isViewable?: boolean;
};

type NativeCachedMedia = NonNullable<
	Awaited<ReturnType<typeof storeAlbumMedia>>
>;

function stripRemoteMediaUrls(
	album: AlbumContentResponse,
): CachedAlbumRecord["album"] {
	return {
		...album,
		content: album.content.map((item) => ({
			contentId: item.contentId,
			contentType: item.contentType,
			processing: item.processing,
			rejectionId: item.rejectionId,
			remainingViews: item.remainingViews,
			statusId: item.statusId,
		})),
	};
}

const records = new Map<number, CachedAlbumRecord | null>();
const listeners = new Map<
	number,
	Set<(record: CachedAlbumRecord | null) => void>
>();
const queue: AlbumDiscovery[] = [];
const queued = new Set<number>();
let processing = false;
let lastRequestStartedAt = 0;

function cacheKey(albumId: number): string {
	return String(albumId);
}

function notify(albumId: number, record: CachedAlbumRecord | null): void {
	records.set(albumId, record);
	for (const listener of listeners.get(albumId) ?? []) listener(record);
}

export function subscribeCachedAlbum(
	albumId: number,
	listener: (record: CachedAlbumRecord | null) => void,
): () => void {
	const albumListeners = listeners.get(albumId) ?? new Set();
	albumListeners.add(listener);
	listeners.set(albumId, albumListeners);
	if (records.has(albumId)) listener(records.get(albumId) ?? null);
	else void readCachedAlbum(albumId).then(listener);
	return () => {
		albumListeners.delete(listener);
		if (albumListeners.size === 0) listeners.delete(albumId);
	};
}

export async function readCachedAlbum(
	albumId: number,
): Promise<CachedAlbumRecord | null> {
	if (records.has(albumId)) return records.get(albumId) ?? null;
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return null;
	const record = await readCacheEntry(
		accountId,
		"album",
		cacheKey(albumId),
		(value) => cachedAlbumRecordSchema.parse(value),
	);
	notify(albumId, record);
	return record;
}

export async function listCachedAlbumsByOwner(
	ownerProfileId: number,
): Promise<CachedAlbumRecord[]> {
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return [];
	const cached = await listCacheEntries(accountId, "album", (value) =>
		cachedAlbumRecordSchema.parse(value),
	);
	for (const record of cached) records.set(record.albumId, record);
	return cached
		.filter((record) => record.ownerProfileId === ownerProfileId)
		.toSorted((left, right) => right.lastAccessedAt - left.lastAccessedAt);
}

async function persist(record: CachedAlbumRecord): Promise<void> {
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return;
	await writeCacheEntry(accountId, "album", cacheKey(record.albumId), record);
	notify(record.albumId, record);
}

export function classifyDiscoveryAccess(
	discovery: AlbumDiscovery,
	now = Date.now(),
): AlbumAccess | null {
	if (discovery.expiresAt !== null && discovery.expiresAt !== undefined) {
		if (discovery.expiresAt <= now) {
			return { status: "unavailable", reason: "expired", detectedAt: now };
		}
	}
	if (discovery.isViewable === false) {
		return {
			status: "unavailable",
			reason: "views_exhausted",
			detectedAt: now,
		};
	}
	return null;
}

export async function discoverSharedAlbum(
	discovery: AlbumDiscovery,
): Promise<void> {
	const cached = await readCachedAlbum(discovery.albumId);
	const forcedAccess = classifyDiscoveryAccess(discovery);
	if (cached && forcedAccess) {
		await persist({ ...cached, access: forcedAccess });
		return;
	}
	if (cached?.access.status === "active") {
		const maximumAge =
			getDeveloperSettingsSnapshot().albumCacheValidationMinutes * 60_000;
		if (Date.now() - cached.access.validatedAt < maximumAge) return;
	}
	if (queued.has(discovery.albumId)) return;
	queued.add(discovery.albumId);
	queue.push(discovery);
	void processQueue();
}

export async function markAlbumUnavailable(
	albumId: number,
	reason: "revoked_or_removed" | "expired" | "views_exhausted",
): Promise<void> {
	const cached = await readCachedAlbum(albumId);
	if (!cached) return;
	await persist({
		...cached,
		access: { status: "unavailable", reason, detectedAt: Date.now() },
	});
}

async function processQueue(): Promise<void> {
	if (processing) return;
	processing = true;
	try {
		while (queue.length > 0) {
			const discovery = queue.shift();
			if (!discovery) break;
			queued.delete(discovery.albumId);
			const session = getAccountSessionSnapshot();
			if (session.accountId === null) continue;
			const interval =
				getDeveloperSettingsSnapshot().albumCacheRequestIntervalMs;
			const waitMs = lastRequestStartedAt + interval - Date.now();
			if (waitMs > 0) await delay(waitMs);
			if (!isAccountSessionCurrent(session)) continue;
			lastRequestStartedAt = Date.now();
			try {
				const album = await getAlbumContent(discovery.albumId);
				if (!isAccountSessionCurrent(session)) continue;
				await cacheLoadedAlbum(discovery, album, session.accountId);
			} catch (error) {
				if (!isAccountSessionCurrent(session)) continue;
				if (
					error instanceof ApiError &&
					error.response?.status === 403 &&
					error.kind !== "RequestBlocked" &&
					error.kind !== "RequestCooldown"
				) {
					await markAlbumUnavailable(discovery.albumId, "revoked_or_removed");
				}
			}
		}
	} finally {
		processing = false;
	}
}

async function cacheLoadedAlbum(
	discovery: AlbumDiscovery,
	album: AlbumContentResponse,
	accountId: number,
): Promise<void> {
	const previous = await readCachedAlbum(album.albumId);
	let media = previous?.media ?? [];
	if (discovery.expirationType !== "ONCE") {
		const candidates = album.content.filter(
			(item) =>
				item.url.length > 0 &&
				item.processing !== true &&
				item.rejectionId === null,
		);
		const maximumBytes = getCacheSizeMbSnapshot() * 1024 * 1024;
		const cached = await mapConcurrent(
			candidates,
			getDeveloperSettingsSnapshot().albumCacheMediaConcurrency,
			(item) =>
				cacheMediaWithRetry(accountId, album.albumId, item, maximumBytes),
		);
		media = cached
			.filter((item) => item !== null)
			.map(({ contentId, contentType, byteLength, token }) => ({
				contentId,
				contentType,
				byteLength,
				token,
			}));
	}
	await persist({
		version: 1,
		albumId: album.albumId,
		ownerProfileId: discovery.ownerProfileId,
		expirationType: discovery.expirationType ?? null,
		expiresAt: discovery.expiresAt ?? null,
		access: { status: "active", validatedAt: Date.now() },
		album: stripRemoteMediaUrls(album),
		media,
		lastAccessedAt: Date.now(),
	});
}

async function cacheMediaWithRetry(
	accountId: number,
	albumId: number,
	item: AlbumContentResponse["content"][number],
	maximumBytes: number,
): Promise<
	(NativeCachedMedia & { contentId: number; contentType: string }) | null
> {
	const retries = getDeveloperSettingsSnapshot().albumCacheCdnRetryLimit;
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			const result = await storeAlbumMedia({
				accountId,
				albumId,
				contentId: item.contentId,
				sourceUrl: item.url,
				contentType: item.contentType,
				maximumBytes,
			});
			if (result === null) return null;
			return {
				...result,
				contentId: item.contentId,
				contentType: item.contentType,
			};
		} catch {
			if (attempt === retries) return null;
			await delay(500 * 2 ** attempt);
		}
	}
	return null;
}

export async function resolveCachedAlbum(
	record: CachedAlbumRecord,
): Promise<AlbumContentResponse> {
	const accountId = getAccountSessionSnapshot().accountId;
	const mediaById = new Map(record.media.map((item) => [item.contentId, item]));
	const content = await Promise.all(
		record.album.content.map(async (item) => {
			const cached = mediaById.get(item.contentId);
			if (!cached || accountId === null)
				return { ...item, coverUrl: null, thumbUrl: "", url: "" };
			const resolved = await lookupAlbumMedia({
				accountId,
				albumId: record.albumId,
				contentId: item.contentId,
			});
			const protocolUrl = resolved.found ? resolved.protocolUrl : "";
			return {
				...item,
				coverUrl: null,
				thumbUrl: protocolUrl,
				url: protocolUrl,
			};
		}),
	);
	return { ...record.album, content };
}

export async function retainViewedAlbumContent(
	discovery: AlbumDiscovery,
	album: AlbumContentResponse,
	contentId: number,
): Promise<void> {
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return;
	const item = album.content.find(
		(candidate) => candidate.contentId === contentId,
	);
	if (!item || item.url.length === 0) return;
	const cached = await cacheMediaWithRetry(
		accountId,
		album.albumId,
		item,
		getCacheSizeMbSnapshot() * 1024 * 1024,
	);
	if (!cached) return;
	const previous = await readCachedAlbum(album.albumId);
	const media = [
		...(previous?.media ?? []).filter(
			(candidate) => candidate.contentId !== contentId,
		),
		{
			contentId,
			contentType: item.contentType,
			byteLength: cached.byteLength,
			token: cached.token,
		},
	];
	await persist({
		version: 1,
		albumId: album.albumId,
		ownerProfileId: discovery.ownerProfileId,
		expirationType: discovery.expirationType ?? null,
		expiresAt: discovery.expiresAt ?? null,
		access: { status: "active", validatedAt: Date.now() },
		album: stripRemoteMediaUrls(album),
		media,
		lastAccessedAt: Date.now(),
	});
}

async function mapConcurrent<T, R>(
	values: T[],
	concurrency: number,
	map: (value: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let index = 0;
	const workers = Array.from(
		{ length: Math.max(1, Math.min(concurrency, values.length)) },
		async () => {
			while (index < values.length) {
				const current = index++;
				results[current] = await map(values[current]);
			}
		},
	);
	await Promise.all(workers);
	return results;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function clearAlbumCacheMemory(): void {
	records.clear();
	queue.length = 0;
	queued.clear();
	processing = false;
	lastRequestStartedAt = 0;
}

registerAccountCache(clearAlbumCacheMemory);
