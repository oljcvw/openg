import { invoke, isTauri } from "@tauri-apps/api/core";
import z from "zod";

const storedSchema = z.object({
	token: z.string().min(1),
	byteLength: z.number().int().nonnegative(),
	protocolUrl: z.string().min(1),
});

const lookupSchema = z.discriminatedUnion("found", [
	z.object({ found: z.literal(false) }),
	z.object({
		found: z.literal(true),
		token: z.string().min(1),
		byteLength: z.number().int().nonnegative(),
		protocolUrl: z.string().min(1),
		contentType: z.string().min(1),
	}),
]);

const statsSchema = z.object({
	byteLength: z.number().int().nonnegative(),
	entryCount: z.number().int().nonnegative(),
	albumCount: z.number().int().nonnegative(),
	accountCount: z.number().int().nonnegative(),
});

export type AlbumMediaCacheStats = z.infer<typeof statsSchema>;
export type AlbumMediaLookup = z.infer<typeof lookupSchema>;

const emptyStats: AlbumMediaCacheStats = {
	byteLength: 0,
	entryCount: 0,
	albumCount: 0,
	accountCount: 0,
};
const listeners = new Set<(stats: AlbumMediaCacheStats) => void>();

function notify(stats: AlbumMediaCacheStats): AlbumMediaCacheStats {
	for (const listener of listeners) listener(stats);
	return stats;
}

export function subscribeAlbumMediaCacheStats(
	listener: (stats: AlbumMediaCacheStats) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function storeAlbumMedia(options: {
	accountId: number;
	albumId: number;
	contentId: number;
	sourceUrl: string;
	contentType: string;
	maximumBytes: number;
}) {
	if (!isTauri()) return null;
	const stored = storedSchema.parse(
		await invoke("album_cache_store", {
			accountId: String(options.accountId),
			albumId: String(options.albumId),
			contentId: String(options.contentId),
			sourceUrl: options.sourceUrl,
			contentType: options.contentType,
			maximumBytes: options.maximumBytes,
		}),
	);
	await trimAlbumMediaCache(options.maximumBytes);
	return stored;
}

export async function lookupAlbumMedia(options: {
	accountId: number;
	albumId: number;
	contentId: number;
}): Promise<AlbumMediaLookup> {
	if (!isTauri()) return { found: false };
	return lookupSchema.parse(
		await invoke("album_cache_lookup", {
			accountId: String(options.accountId),
			albumId: String(options.albumId),
			contentId: String(options.contentId),
		}),
	);
}

export async function getAlbumMediaCacheStats(
	accountId?: number,
): Promise<AlbumMediaCacheStats> {
	if (!isTauri()) return emptyStats;
	return statsSchema.parse(
		await invoke("album_cache_stats", {
			accountId: accountId === undefined ? null : String(accountId),
		}),
	);
}

export async function trimAlbumMediaCache(
	maximumBytes: number,
): Promise<AlbumMediaCacheStats> {
	if (!isTauri()) return emptyStats;
	return notify(
		statsSchema.parse(await invoke("album_cache_trim", { maximumBytes })),
	);
}

export async function clearAlbumMediaCache(
	accountId?: number,
): Promise<AlbumMediaCacheStats> {
	if (!isTauri()) return emptyStats;
	return notify(
		statsSchema.parse(
			await invoke("album_cache_clear", {
				accountId: accountId === undefined ? null : String(accountId),
			}),
		),
	);
}
