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

const recordPageSchema = z.object({
	records: z.array(z.unknown()),
	nextCursor: z.string().nullable(),
});

const membershipSnapshotSchema = z.object({
	version: z.literal(5),
	currentAlbumIds: z.array(z.number().int().nonnegative()),
	listedAt: z.number().int().nonnegative(),
});

export type AlbumMembershipSnapshotRecord = z.infer<
	typeof membershipSnapshotSchema
>;

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
	ownerProfileId: number;
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
			ownerProfileId: String(options.ownerProfileId),
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
	ownerProfileId: number;
	albumId: number;
	contentId: number;
}): Promise<AlbumMediaLookup> {
	if (!isTauri()) return { found: false };
	return lookupSchema.parse(
		await invoke("album_cache_lookup", {
			accountId: String(options.accountId),
			ownerProfileId: String(options.ownerProfileId),
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

export async function storeAlbumRecord(options: {
	accountId: number;
	ownerProfileId: number;
	albumId: number;
	record: unknown;
}): Promise<boolean> {
	if (!isTauri()) return false;
	await invoke("album_cache_record_store", {
		accountId: String(options.accountId),
		ownerProfileId: String(options.ownerProfileId),
		albumId: String(options.albumId),
		record: options.record,
	});
	return true;
}

export async function readAlbumRecord(options: {
	accountId: number;
	ownerProfileId: number;
	albumId: number;
}): Promise<unknown | null> {
	if (!isTauri()) return null;
	return await invoke("album_cache_record_read", {
		accountId: String(options.accountId),
		ownerProfileId: String(options.ownerProfileId),
		albumId: String(options.albumId),
	});
}

export async function bindLegacyAlbumMediaOwner(options: {
	accountId: number;
	ownerProfileId: number;
	albumId: number;
}): Promise<number> {
	if (!isTauri()) return 0;
	return z
		.number()
		.int()
		.nonnegative()
		.parse(
			await invoke("album_cache_bind_legacy_owner", {
				accountId: String(options.accountId),
				ownerProfileId: String(options.ownerProfileId),
				albumId: String(options.albumId),
			}),
		);
}

export async function pageAlbumRecords(options: {
	accountId: number;
	ownerProfileId: number;
	cursor: string | null;
}): Promise<{ records: unknown[]; nextCursor: string | null } | null> {
	if (!isTauri()) return null;
	return recordPageSchema.parse(
		await invoke("album_cache_records_page", {
			accountId: String(options.accountId),
			ownerProfileId: String(options.ownerProfileId),
			cursor: options.cursor,
		}),
	);
}

export async function reconcileAlbumRecordsMembership(options: {
	accountId: number;
	ownerProfileId: number;
	currentAlbumIds: readonly number[];
	listedAt: number;
}): Promise<boolean> {
	if (!isTauri()) return false;
	await invoke("album_cache_records_reconcile_membership", {
		accountId: String(options.accountId),
		ownerProfileId: String(options.ownerProfileId),
		currentAlbumIds: options.currentAlbumIds.map(String),
		listedAt: options.listedAt,
	});
	return true;
}

export async function storeAlbumMembershipSnapshotRecord(options: {
	accountId: number;
	ownerProfileId: number;
	currentAlbumIds: readonly number[];
	listedAt: number;
}): Promise<boolean> {
	if (!isTauri()) return false;
	await invoke("album_cache_membership_snapshot_store", {
		accountId: String(options.accountId),
		ownerProfileId: String(options.ownerProfileId),
		currentAlbumIds: options.currentAlbumIds,
		listedAt: options.listedAt,
	});
	return true;
}

export async function readAlbumMembershipSnapshotRecord(options: {
	accountId: number;
	ownerProfileId: number;
}): Promise<AlbumMembershipSnapshotRecord | null> {
	if (!isTauri()) return null;
	const value = await invoke("album_cache_membership_snapshot_read", {
		accountId: String(options.accountId),
		ownerProfileId: String(options.ownerProfileId),
	});
	return value === null ? null : membershipSnapshotSchema.parse(value);
}
