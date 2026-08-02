import { invoke, isTauri } from "@tauri-apps/api/core";
import z from "zod";

import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";

const cacheStatsSchema = z.object({
	byteLength: z.number().int().nonnegative(),
	entryCount: z.number().int().nonnegative(),
});

const cachedVideoSchema = z.discriminatedUnion("found", [
	z.object({ found: z.literal(false) }),
	z.object({
		found: z.literal(true),
		dataBase64: z.string().min(1),
		contentType: z.literal("video/mp4"),
		byteLength: z.number().int().positive(),
	}),
]);

export type ShortVideoCacheStats = z.infer<typeof cacheStatsSchema>;
export type CachedShortVideo = z.infer<typeof cachedVideoSchema>;

const listeners = new Set<(stats: ShortVideoCacheStats) => void>();
const emptyStats: ShortVideoCacheStats = { byteLength: 0, entryCount: 0 };

function activeAccountId(): string | null {
	return getAccountSessionSnapshot().accountId?.toString() ?? null;
}

function maximumBytes(): number {
	return getDeveloperSettingsSnapshot().shortVideoCacheMb * 1024 * 1024;
}

function notify(stats: ShortVideoCacheStats): ShortVideoCacheStats {
	for (const listener of listeners) listener(stats);
	return stats;
}

export async function cacheShortVideo(
	mediaId: number,
	dataBase64: string,
): Promise<ShortVideoCacheStats> {
	const accountId = activeAccountId();
	if (!isTauri() || accountId === null) return emptyStats;
	const response = await invoke("short_video_cache_put", {
		accountId,
		mediaId: String(mediaId),
		dataBase64,
		maximumBytes: maximumBytes(),
	});
	return notify(cacheStatsSchema.parse(response));
}

export async function getCachedShortVideo(
	mediaId: number,
): Promise<CachedShortVideo> {
	const accountId = activeAccountId();
	if (!isTauri() || accountId === null) return { found: false };
	return cachedVideoSchema.parse(
		await invoke("short_video_cache_get", {
			accountId,
			mediaId: String(mediaId),
		}),
	);
}

export async function clearShortVideoCache(
	accountId?: number,
): Promise<ShortVideoCacheStats> {
	if (!isTauri()) return notify(emptyStats);
	const response = await invoke("short_video_cache_clear", {
		accountId: accountId?.toString(),
	});
	return notify(cacheStatsSchema.parse(response));
}

export async function trimShortVideoCache(): Promise<ShortVideoCacheStats> {
	if (!isTauri()) return notify(emptyStats);
	const response = await invoke("short_video_cache_trim", {
		maximumBytes: maximumBytes(),
	});
	return notify(cacheStatsSchema.parse(response));
}

export async function getShortVideoCacheStats(): Promise<ShortVideoCacheStats> {
	if (!isTauri()) return emptyStats;
	return cacheStatsSchema.parse(await invoke("short_video_cache_stats"));
}

export function subscribeShortVideoCacheStats(
	listener: (stats: ShortVideoCacheStats) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
