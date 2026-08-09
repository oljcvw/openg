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
import { observeBackgroundTask } from "$lib/platform/client-diagnostics";
import {
	bindLegacyAlbumMediaOwner,
	lookupAlbumMedia,
	pageAlbumRecords,
	readAlbumMembershipSnapshotRecord,
	readAlbumRecord,
	reconcileAlbumRecordsMembership,
	storeAlbumMedia,
	storeAlbumMembershipSnapshotRecord,
	storeAlbumRecord,
} from "./album-media-cache";
import {
	listCacheEntryPage,
	readCacheEntry,
	removeCacheEntry,
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

const cachedAlbumRecordV1Schema = z.object({
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

const retainedItemSchema = z.object({
	contentId: z.number().int(),
	contentType: z.string(),
	firstSeenAt: z.number().int(),
	lastSeenAt: z.number().int(),
	removedAt: z.number().int().nullable(),
	cacheToken: z.string().min(1).nullable(),
	byteLength: z.number().int().nonnegative().nullable(),
});

export const cachedAlbumRecordSchema = cachedAlbumRecordV1Schema.extend({
	version: z.literal(2),
	identity: z.object({
		accountProfileId: z.number().int(),
		ownerProfileId: z.number().int(),
		albumId: z.number().int(),
	}),
	membership: z.object({
		isCurrentlyShared: z.boolean(),
		lastListedAt: z.number().int(),
		unavailableReason: z
			.enum(["unshared", "expired", "views_exhausted", "deleted"])
			.nullable(),
	}),
	currentSnapshot: z
		.object({
			albumName: z.string().nullable(),
			updatedAt: z.string(),
			contentFingerprint: z.string(),
			orderedContentIds: z.array(z.number().int()),
		})
		.nullable(),
	retainedItems: z.array(retainedItemSchema),
	historyOrder: z
		.object({
			source: z.literal("beta4"),
			sequence: z.number().int().nonnegative(),
		})
		.nullable()
		.default(null),
});

export type CachedAlbumRecord = z.infer<typeof cachedAlbumRecordSchema>;
export type AlbumAccess = CachedAlbumRecord["access"];
export type SharedAlbumIdentity = CachedAlbumRecord["identity"];
export type RetainedAlbumItem = CachedAlbumRecord["retainedItems"][number];

export function albumIdentityKey(identity: SharedAlbumIdentity): string {
	return `${identity.accountProfileId}:${identity.ownerProfileId}:${identity.albumId}`;
}

export function contentFingerprint<
	T extends { contentId: number; contentType: string },
>(items: ReadonlyArray<T>): string {
	return items.map((item) => `${item.contentId}:${item.contentType}`).join("|");
}

export function reconcileRetainedItems(
	previous: RetainedAlbumItem[],
	current: ReadonlyArray<{ contentId: number; contentType: string }>,
	now: number,
): RetainedAlbumItem[] {
	const currentIds = new Set(current.map((item) => item.contentId));
	const byId = new Map(previous.map((item) => [item.contentId, item]));
	const retained = previous.map((item) => ({
		...item,
		removedAt: currentIds.has(item.contentId) ? null : (item.removedAt ?? now),
	}));
	for (const item of current) {
		const existing = byId.get(item.contentId);
		if (existing) {
			const index = retained.findIndex(
				(candidate) => candidate.contentId === item.contentId,
			);
			retained[index] = {
				...existing,
				contentType: item.contentType,
				lastSeenAt: now,
				removedAt: null,
			};
		} else {
			retained.push({
				...item,
				firstSeenAt: now,
				lastSeenAt: now,
				removedAt: null,
				cacheToken: null,
				byteLength: null,
			});
		}
	}
	return retained;
}

const ALBUM_HISTORY_PAGE_SIZE = 60;
const albumMigrationLedgerSchema = z.object({
	version: z.literal(5),
	cursor: z.string().nullable(),
	complete: z.boolean(),
	nextHistorySequence: z.number().int().nonnegative().default(0),
});

const albumMembershipSnapshotSchema = z.object({
	version: z.literal(5),
	currentAlbumIds: z.array(z.number().int()),
	listedAt: z.number().int(),
});

export type AlbumMembershipSnapshot = z.infer<
	typeof albumMembershipSnapshotSchema
>;

export function pageAlbumHistoryRecords<T>(
	records: T[],
	offset: number,
): { items: T[]; nextOffset: number | null } {
	const safeOffset = Math.max(0, Math.trunc(offset));
	const items = records.slice(safeOffset, safeOffset + ALBUM_HISTORY_PAGE_SIZE);
	const nextOffset =
		safeOffset + items.length < records.length
			? safeOffset + items.length
			: null;
	return { items, nextOffset };
}

export function ownerScopedAlbumMigrationRecords<
	T extends { identity: { ownerProfileId: number } },
>(records: T[], ownerProfileId: number): T[] {
	return records.filter(
		(record) => record.identity.ownerProfileId === ownerProfileId,
	);
}

export function advanceAlbumMigrationProgress(
	currentCursor: string | null,
	processedKeys: readonly string[],
	nextCursor: string | null,
	processedPage: boolean,
): { cursor: string | null; complete: boolean } {
	return {
		cursor: processedKeys.at(-1) ?? currentCursor,
		complete: processedPage && nextCursor === null,
	};
}

export function reconcileAlbumMembership<
	T extends {
		albumId: number;
		membership: CachedAlbumRecord["membership"];
	},
>(records: T[], currentAlbumIds: ReadonlySet<number>, listedAt: number): T[] {
	return records.map((record) => {
		const isCurrentlyShared = currentAlbumIds.has(record.albumId);
		return {
			...record,
			membership: {
				...record.membership,
				isCurrentlyShared,
				lastListedAt: listedAt,
				unavailableReason: isCurrentlyShared
					? null
					: (record.membership.unavailableReason ?? "unshared"),
			},
		};
	});
}

export function applyAuthoritativeAlbumMembership<
	T extends {
		albumId: number;
		membership: CachedAlbumRecord["membership"];
	},
>(record: T, snapshot: AlbumMembershipSnapshot | null): T {
	if (snapshot === null) return record;
	return reconcileAlbumMembership(
		[record],
		new Set(snapshot.currentAlbumIds),
		snapshot.listedAt,
	)[0];
}

export function albumHistoryCursorScopeKey(
	accountProfileId: number,
	ownerProfileId: number,
	cursor: string,
): string {
	return JSON.stringify([accountProfileId, ownerProfileId, cursor]);
}

export function compareAlbumHistoryOrder(
	left: CachedAlbumRecord,
	right: CachedAlbumRecord,
): number {
	if (left.historyOrder === null && right.historyOrder !== null) return -1;
	if (left.historyOrder !== null && right.historyOrder === null) return 1;
	if (left.historyOrder !== null && right.historyOrder !== null) {
		const bySequence = left.historyOrder.sequence - right.historyOrder.sequence;
		if (bySequence !== 0) return bySequence;
	}
	const byAccess = right.lastAccessedAt - left.lastAccessedAt;
	if (byAccess !== 0) return byAccess;
	return albumIdentityKey(left.identity).localeCompare(
		albumIdentityKey(right.identity),
	);
}

type AlbumHistoryScope = {
	accountProfileId: number;
	ownerProfileId: number;
};

function albumHistoryOwnerScopeKey(
	accountProfileId: number,
	ownerProfileId: number,
): string {
	return JSON.stringify([accountProfileId, ownerProfileId]);
}

/** A per-owner LRU. Values are copied so consumers cannot retain cache storage. */
export class AlbumHistoryPageCache<T> {
	readonly #maximumPagesPerOwner: number;
	readonly #owners = new Map<string, Map<string, T[]>>();

	constructor(maximumPagesPerOwner = 3) {
		this.#maximumPagesPerOwner = Math.max(1, maximumPagesPerOwner);
	}

	set(
		accountProfileId: number,
		ownerProfileId: number,
		cursor: string | null,
		value: readonly T[],
	): void {
		const ownerKey = albumHistoryOwnerScopeKey(
			accountProfileId,
			ownerProfileId,
		);
		const pages = this.#owners.get(ownerKey) ?? new Map<string, T[]>();
		const pageKey = cursor ?? "";
		pages.delete(pageKey);
		pages.set(pageKey, [...value]);
		while (pages.size > this.#maximumPagesPerOwner) {
			const oldest = pages.keys().next().value;
			if (oldest === undefined) break;
			pages.delete(oldest);
		}
		this.#owners.set(ownerKey, pages);
	}

	get(
		accountProfileId: number,
		ownerProfileId: number,
		cursor: string | null,
	): T[] | null {
		const pages = this.#owners.get(
			albumHistoryOwnerScopeKey(accountProfileId, ownerProfileId),
		);
		const pageKey = cursor ?? "";
		const value = pages?.get(pageKey);
		if (value === undefined || pages === undefined) return null;
		pages.delete(pageKey);
		pages.set(pageKey, value);
		return [...value];
	}

	closeOwner(accountProfileId: number, ownerProfileId: number): void {
		this.#owners.delete(
			albumHistoryOwnerScopeKey(accountProfileId, ownerProfileId),
		);
	}

	clear(): void {
		this.#owners.clear();
	}
}

export class AlbumHistoryCursorRegistry<T> {
	readonly #capacity: number;
	readonly #ttlMs: number;
	readonly #now: () => number;
	readonly #entries = new Map<
		string,
		AlbumHistoryScope & { expiresAt: number; value: T }
	>();

	constructor(options: {
		capacity: number;
		ttlMs: number;
		now?: () => number;
	}) {
		this.#capacity = Math.max(1, options.capacity);
		this.#ttlMs = Math.max(1, options.ttlMs);
		this.#now = options.now ?? Date.now;
	}

	set(
		token: string,
		accountProfileId: number,
		ownerProfileId: number,
		value: T,
	): void {
		this.#prune();
		this.#entries.delete(token);
		this.#entries.set(token, {
			accountProfileId,
			ownerProfileId,
			expiresAt: this.#now() + this.#ttlMs,
			value,
		});
		while (this.#entries.size > this.#capacity) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
	}

	take(
		token: string,
		accountProfileId: number,
		ownerProfileId: number,
	): T | null {
		this.#prune();
		const entry = this.#entries.get(token);
		if (
			entry === undefined ||
			entry.accountProfileId !== accountProfileId ||
			entry.ownerProfileId !== ownerProfileId
		)
			return null;
		this.#entries.delete(token);
		return entry.value;
	}

	closeOwner(accountProfileId: number, ownerProfileId: number): void {
		for (const [token, entry] of this.#entries) {
			if (
				entry.accountProfileId === accountProfileId &&
				entry.ownerProfileId === ownerProfileId
			)
				this.#entries.delete(token);
		}
	}

	clear(): void {
		this.#entries.clear();
	}

	#prune(): void {
		const now = this.#now();
		for (const [token, entry] of this.#entries) {
			if (entry.expiresAt <= now) this.#entries.delete(token);
		}
	}
}

const historyPages = new AlbumHistoryPageCache<CachedAlbumRecord>(3);
const historyPageNextCursors = new AlbumHistoryPageCache<string | null>(3);
const historyCursors = new AlbumHistoryCursorRegistry<{
	offset: number;
}>({ capacity: 32, ttlMs: 5 * 60_000 });
const genericAlbumMigrationProgress = new Map<
	string,
	{
		cursor: string | null;
		complete: boolean;
		nextHistorySequence: number;
	}
>();
const albumMigrationContinuation = new Map<string, boolean>();

export function migrateBeta4AlbumRecord(
	identity: SharedAlbumIdentity,
	legacy: z.infer<typeof cachedAlbumRecordV1Schema>,
	membershipSnapshot: AlbumMembershipSnapshot | null = null,
	historyOrder: CachedAlbumRecord["historyOrder"] = null,
): CachedAlbumRecord {
	const now = Date.now();
	return applyAuthoritativeAlbumMembership(
		{
			...legacy,
			version: 2,
			ownerProfileId: identity.ownerProfileId,
			identity,
			membership: {
				isCurrentlyShared: legacy.access.status === "active",
				lastListedAt: legacy.lastAccessedAt,
				unavailableReason:
					legacy.access.status !== "unavailable"
						? null
						: legacy.access.reason === "expired"
							? "expired"
							: legacy.access.reason === "views_exhausted"
								? "views_exhausted"
								: "unshared",
			},
			currentSnapshot: {
				albumName: legacy.album.albumName,
				updatedAt: legacy.album.updatedAt,
				contentFingerprint: contentFingerprint(legacy.album.content),
				orderedContentIds: legacy.album.content.map((item) => item.contentId),
			},
			retainedItems: legacy.album.content.map((item) => {
				const media = legacy.media.find(
					(candidate) => candidate.contentId === item.contentId,
				);
				return {
					contentId: item.contentId,
					contentType: item.contentType,
					firstSeenAt: legacy.lastAccessedAt || now,
					lastSeenAt: legacy.lastAccessedAt || now,
					removedAt: null,
					cacheToken: media?.token ?? null,
					byteLength: media?.byteLength ?? null,
				};
			}),
			historyOrder,
		},
		membershipSnapshot,
	);
}

function albumMembershipSnapshotKey(ownerProfileId: number): string {
	return `beta5-album-membership-${ownerProfileId}`;
}

async function readAlbumMembershipSnapshot(
	accountProfileId: number,
	ownerProfileId: number,
): Promise<AlbumMembershipSnapshot | null> {
	const native = albumMembershipSnapshotSchema.safeParse(
		await readAlbumMembershipSnapshotRecord({
			accountId: accountProfileId,
			ownerProfileId,
		}),
	);
	if (native.success) return native.data;
	return await readCacheEntry(
		accountProfileId,
		"migration",
		albumMembershipSnapshotKey(ownerProfileId),
		(value) => albumMembershipSnapshotSchema.parse(value),
	);
}

function identityForDiscovery(
	discovery: AlbumDiscovery,
	accountProfileId: number,
): SharedAlbumIdentity | null {
	if (discovery.ownerProfileId === null) return null;
	return {
		accountProfileId,
		ownerProfileId: discovery.ownerProfileId,
		albumId: discovery.albumId,
	};
}

export function ownerlessLegacyMatchesValidatedIdentity(
	legacy: { albumId: number; ownerProfileId: number | null },
	identity: SharedAlbumIdentity,
): boolean {
	return legacy.ownerProfileId === null && legacy.albumId === identity.albumId;
}

export type AlbumDiscovery = {
	albumId: number;
	ownerProfileId: number | null;
	expirationType?: string | null;
	expiresAt?: number | null;
	isViewable?: boolean;
	/** Set only after a parsed message/list/detail proves the owner identity. */
	ownerValidated?: boolean;
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

const records = new Map<string, CachedAlbumRecord | null>();
const listeners = new Map<
	string,
	Set<(record: CachedAlbumRecord | null) => void>
>();
const queue: Array<{
	discovery: AlbumDiscovery;
	identity: SharedAlbumIdentity;
}> = [];
const queued = new Set<string>();
let processing = false;
let lastRequestStartedAt = 0;

function cacheKey(ownerProfileId: number, albumId: number): string {
	return `${ownerProfileId}:${albumId}`;
}

function notify(
	identity: SharedAlbumIdentity,
	record: CachedAlbumRecord | null,
): void {
	const key = albumIdentityKey(identity);
	const activeListeners = listeners.get(key);
	if (activeListeners === undefined || activeListeners.size === 0) {
		records.delete(key);
		return;
	}
	records.set(key, record);
	for (const listener of activeListeners) listener(record);
}

export function subscribeCachedAlbum(
	identity: SharedAlbumIdentity | number,
	listener: (record: CachedAlbumRecord | null) => void,
): () => void {
	if (typeof identity === "number") return () => {};
	const key = albumIdentityKey(identity);
	const albumListeners = listeners.get(key) ?? new Set();
	albumListeners.add(listener);
	listeners.set(key, albumListeners);
	if (records.has(key)) listener(records.get(key) ?? null);
	else {
		observeBackgroundTask(
			readCachedAlbum(identity).then(() => undefined),
			{
				category: "cache_recovery",
				component: "album",
				code: "album_cache_hydration_failed",
			},
		);
	}
	return () => {
		albumListeners.delete(listener);
		if (albumListeners.size === 0) {
			listeners.delete(key);
			records.delete(key);
		}
	};
}

export async function readCachedAlbum(
	identity: SharedAlbumIdentity | number,
): Promise<CachedAlbumRecord | null> {
	if (typeof identity === "number") return null;
	const key = albumIdentityKey(identity);
	if (records.has(key)) return records.get(key) ?? null;
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId !== identity.accountProfileId) return null;
	const nativeRecord = await readAlbumRecord({
		accountId,
		ownerProfileId: identity.ownerProfileId,
		albumId: identity.albumId,
	});
	let record =
		nativeRecord === null ? null : cachedAlbumRecordSchema.parse(nativeRecord);
	if (!record)
		record = await readCacheEntry(
			accountId,
			"album",
			cacheKey(identity.ownerProfileId, identity.albumId),
			(value) => cachedAlbumRecordSchema.parse(value),
		);
	if (!record) {
		const legacy = await readCacheEntry(
			accountId,
			"album",
			String(identity.albumId),
			(value) => cachedAlbumRecordV1Schema.parse(value),
		);
		if (legacy?.ownerProfileId === identity.ownerProfileId) {
			record = await migrateLegacyAlbumRecord(identity, legacy);
		}
	}
	if (record !== null) {
		record = applyAuthoritativeAlbumMembership(
			record,
			await readAlbumMembershipSnapshot(
				identity.accountProfileId,
				identity.ownerProfileId,
			),
		);
	}
	notify(identity, record);
	return record;
}

async function migrateLegacyAlbumRecord(
	identity: SharedAlbumIdentity,
	legacy: z.infer<typeof cachedAlbumRecordV1Schema>,
	membershipSnapshot?: AlbumMembershipSnapshot | null,
	historyOrder: CachedAlbumRecord["historyOrder"] = null,
): Promise<CachedAlbumRecord> {
	const session = getAccountSessionSnapshot();
	const authoritativeMembership =
		membershipSnapshot === undefined
			? await readAlbumMembershipSnapshot(
					identity.accountProfileId,
					identity.ownerProfileId,
				)
			: membershipSnapshot;
	const migrated = migrateBeta4AlbumRecord(
		identity,
		legacy,
		authoritativeMembership,
		historyOrder,
	);
	if (session.accountId !== identity.accountProfileId) return migrated;
	await bindLegacyAlbumMediaOwner({
		accountId: identity.accountProfileId,
		ownerProfileId: identity.ownerProfileId,
		albumId: identity.albumId,
	});
	if (!isAccountSessionCurrent(session)) return migrated;
	const verified = await storeAndVerifyAlbumRecord(migrated, session);
	if (verified === null) return migrated;
	await removeCacheEntry(
		identity.accountProfileId,
		"album",
		String(identity.albumId),
	);
	return verified;
}

async function storeAndVerifyAlbumRecord(
	record: CachedAlbumRecord,
	session: ReturnType<typeof getAccountSessionSnapshot>,
): Promise<CachedAlbumRecord | null> {
	const identity = record.identity;
	const stored = await storeAlbumRecord({
		accountId: identity.accountProfileId,
		ownerProfileId: identity.ownerProfileId,
		albumId: identity.albumId,
		record,
	});
	if (!stored || !isAccountSessionCurrent(session)) return null;
	const verified = cachedAlbumRecordSchema.safeParse(
		await readAlbumRecord({
			accountId: identity.accountProfileId,
			ownerProfileId: identity.ownerProfileId,
			albumId: identity.albumId,
		}),
	);
	if (
		!verified.success ||
		albumIdentityKey(verified.data.identity) !== albumIdentityKey(identity) ||
		!isAccountSessionCurrent(session)
	)
		return null;
	return verified.data;
}

export async function bindOwnerlessLegacyAlbum(
	identity: SharedAlbumIdentity,
): Promise<CachedAlbumRecord | null> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== identity.accountProfileId) return null;
	const legacy = await readCacheEntry(
		identity.accountProfileId,
		"album",
		String(identity.albumId),
		(value) => cachedAlbumRecordV1Schema.parse(value),
	);
	if (
		legacy === null ||
		!ownerlessLegacyMatchesValidatedIdentity(legacy, identity) ||
		!isAccountSessionCurrent(session)
	)
		return null;
	const migrated = await migrateLegacyAlbumRecord(identity, legacy);
	if (!isAccountSessionCurrent(session)) return null;
	notify(identity, migrated);
	return migrated;
}

export async function listCachedAlbumsByOwner(
	ownerProfileId: number,
): Promise<CachedAlbumRecord[]> {
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return [];
	const nativePage = await pageAlbumRecords({
		accountId,
		ownerProfileId,
		cursor: null,
	});
	const nativeRecords =
		nativePage?.records.map((record) =>
			cachedAlbumRecordSchema.parse(record),
		) ?? [];
	const migrationKey = `beta5-albums-${ownerProfileId}`;
	const migrationLedger = (await readCacheEntry(
		accountId,
		"migration",
		migrationKey,
		(value) => albumMigrationLedgerSchema.parse(value),
	)) ?? {
		version: 5 as const,
		cursor: null,
		complete: false,
		nextHistorySequence: 0,
	};
	const genericProgressKey = `${accountId}:${ownerProfileId}`;
	const migrationProgress =
		nativePage === null
			? (genericAlbumMigrationProgress.get(genericProgressKey) ?? {
					cursor: null,
					complete: false,
					nextHistorySequence: 0,
				})
			: migrationLedger;
	const membershipSnapshot = await readAlbumMembershipSnapshot(
		accountId,
		ownerProfileId,
	);
	const cachedPage = migrationProgress.complete
		? { items: [], nextCursor: null }
		: await listCacheEntryPage(
				accountId,
				"album",
				(
					value,
				): {
					record: CachedAlbumRecord | null;
					migrated: boolean;
				} => {
					const v2 = cachedAlbumRecordSchema.safeParse(value);
					if (v2.success)
						return {
							record:
								v2.data.identity.ownerProfileId === ownerProfileId
									? applyAuthoritativeAlbumMembership(
											v2.data,
											membershipSnapshot,
										)
									: v2.data,
							migrated: false,
						};
					const v1 = cachedAlbumRecordV1Schema.parse(value);
					if (v1.ownerProfileId === null)
						return { record: null, migrated: false };
					return {
						record: migrateBeta4AlbumRecord(
							{
								accountProfileId: accountId,
								ownerProfileId: v1.ownerProfileId,
								albumId: v1.albumId,
							},
							v1,
							v1.ownerProfileId === ownerProfileId ? membershipSnapshot : null,
						),
						migrated: true,
					};
				},
				migrationProgress.cursor,
				ALBUM_HISTORY_PAGE_SIZE,
			);
	let allocatedHistorySequence = migrationProgress.nextHistorySequence;
	const cached = cachedPage.items.map((item) => {
		let record = item.value.record;
		if (
			record !== null &&
			record.identity.accountProfileId === accountId &&
			record.identity.ownerProfileId === ownerProfileId &&
			record.historyOrder === null
		) {
			record = {
				...record,
				historyOrder: {
					source: "beta4",
					sequence: allocatedHistorySequence,
				},
			};
			allocatedHistorySequence += 1;
		}
		return {
			...item.value,
			record,
			key: item.key,
		};
	});
	const usable = [
		...nativeRecords,
		...[...records.values()].filter(
			(record): record is CachedAlbumRecord =>
				record !== null &&
				record.identity.accountProfileId === accountId &&
				record.identity.ownerProfileId === ownerProfileId,
		),
		...cached
			.map((entry) => entry.record)
			.filter((record): record is CachedAlbumRecord => record !== null),
	];
	const unique = [
		...new Map(
			usable.map((record) => [albumIdentityKey(record.identity), record]),
		).values(),
	];
	const session = getAccountSessionSnapshot();
	const processedKeys: string[] = [];
	let processedNextHistorySequence = migrationProgress.nextHistorySequence;
	let processedPage = true;
	for (const source of cached) {
		if (!isAccountSessionCurrent(session)) return [];
		const record = source.record;
		if (
			record?.identity.accountProfileId === accountId &&
			record.identity.ownerProfileId === ownerProfileId &&
			nativePage !== null
		) {
			let verified: CachedAlbumRecord | null;
			if (source.migrated) {
				const legacy = await readCacheEntry(
					accountId,
					"album",
					source.key,
					(value) => cachedAlbumRecordV1Schema.parse(value),
				);
				verified =
					legacy === null
						? null
						: await migrateLegacyAlbumRecord(
								record.identity,
								legacy,
								membershipSnapshot,
								record.historyOrder,
							);
			} else {
				verified = await storeAndVerifyAlbumRecord(record, session);
				if (verified !== null)
					await removeCacheEntry(accountId, "album", source.key);
			}
			const durable = cachedAlbumRecordSchema.safeParse(
				await readAlbumRecord({
					accountId,
					ownerProfileId: record.identity.ownerProfileId,
					albumId: record.identity.albumId,
				}),
			);
			if (
				verified === null ||
				!durable.success ||
				albumIdentityKey(durable.data.identity) !==
					albumIdentityKey(record.identity)
			) {
				processedPage = false;
				break;
			}
		}
		if (
			record?.identity.accountProfileId === accountId &&
			record.identity.ownerProfileId === ownerProfileId &&
			record.historyOrder !== null
		)
			processedNextHistorySequence = Math.max(
				processedNextHistorySequence,
				record.historyOrder.sequence + 1,
			);
		processedKeys.push(source.key);
	}
	const nextProgress = advanceAlbumMigrationProgress(
		migrationProgress.cursor,
		processedKeys,
		cachedPage.nextCursor,
		processedPage,
	);
	const migrationComplete = nextProgress.complete;
	albumMigrationContinuation.set(genericProgressKey, !migrationComplete);
	if (nativePage === null) {
		genericAlbumMigrationProgress.set(genericProgressKey, {
			cursor: nextProgress.cursor,
			complete: migrationComplete,
			nextHistorySequence: processedNextHistorySequence,
		});
	} else if (isAccountSessionCurrent(session) && !migrationLedger.complete) {
		await writeCacheEntry(accountId, "migration", migrationKey, {
			version: 5,
			cursor: nextProgress.cursor,
			complete: migrationComplete,
			nextHistorySequence: processedNextHistorySequence,
		});
	}
	return unique
		.filter(
			(record) =>
				record.identity.accountProfileId === accountId &&
				record.identity.ownerProfileId === ownerProfileId,
		)
		.toSorted(compareAlbumHistoryOrder);
}

export async function listCachedAlbumHistoryPage(
	ownerProfileId: number,
	cursor: string | null = null,
): Promise<{ items: CachedAlbumRecord[]; nextCursor: string | null }> {
	const session = getAccountSessionSnapshot();
	const accountProfileId = session.accountId;
	if (accountProfileId === null) return { items: [], nextCursor: null };
	const cachedPage = historyPages.get(accountProfileId, ownerProfileId, cursor);
	const cachedNextCursor = historyPageNextCursors.get(
		accountProfileId,
		ownerProfileId,
		cursor,
	)?.[0];
	if (cachedPage !== null && cachedNextCursor !== undefined)
		return { items: cachedPage, nextCursor: cachedNextCursor };
	const localCursor =
		cursor === null
			? null
			: historyCursors.take(cursor, accountProfileId, ownerProfileId);
	if (localCursor) {
		const ownerRecords = await listCachedAlbumsByOwner(ownerProfileId);
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
		const migrationPending =
			albumMigrationContinuation.get(
				`${accountProfileId}:${ownerProfileId}`,
			) === true;
		const page = pageAlbumHistoryRecords(ownerRecords, localCursor.offset);
		if (page.nextOffset === null && !migrationPending)
			return { items: page.items, nextCursor: null };
		const nextCursor = crypto.randomUUID();
		historyCursors.set(nextCursor, accountProfileId, ownerProfileId, {
			offset: page.nextOffset ?? localCursor.offset + page.items.length,
		});
		return { items: page.items, nextCursor };
	}
	let compatibleLegacy: CachedAlbumRecord[] | null = null;
	if (cursor === null) {
		// Advance one bounded generic beta-4 page on every collection load,
		// including after the native history has become non-empty.
		compatibleLegacy = await listCachedAlbumsByOwner(ownerProfileId);
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
	}
	let nativePage = await pageAlbumRecords({
		accountId: accountProfileId,
		ownerProfileId,
		cursor,
	});
	if (!isAccountSessionCurrent(session)) return { items: [], nextCursor: null };
	if (
		nativePage !== null &&
		cursor === null &&
		nativePage.records.length === 0
	) {
		// A first-page miss may mean this account still has generic v1 records.
		// Migrate at most one page, then retry the durable native index.
		compatibleLegacy ??= await listCachedAlbumsByOwner(ownerProfileId);
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
		nativePage = await pageAlbumRecords({
			accountId: accountProfileId,
			ownerProfileId,
			cursor: null,
		});
		if (!isAccountSessionCurrent(session))
			return { items: [], nextCursor: null };
		if (nativePage?.records.length === 0 && compatibleLegacy.length > 0)
			nativePage = null;
	}
	if (nativePage !== null) {
		const items = nativePage.records.map((record) =>
			cachedAlbumRecordSchema.parse(record),
		);
		const nextCursor = nativePage.nextCursor;
		historyPages.set(accountProfileId, ownerProfileId, cursor, items);
		historyPageNextCursors.set(accountProfileId, ownerProfileId, cursor, [
			nextCursor,
		]);
		return {
			items,
			nextCursor,
		};
	}
	if (cursor !== null) {
		return { items: [], nextCursor: null };
	}
	const historyRecords =
		compatibleLegacy ?? (await listCachedAlbumsByOwner(ownerProfileId));
	if (!isAccountSessionCurrent(session)) return { items: [], nextCursor: null };
	const page = pageAlbumHistoryRecords(historyRecords, 0);
	if (page.nextOffset === null) return { items: page.items, nextCursor: null };
	const nextCursor = crypto.randomUUID();
	historyCursors.set(nextCursor, accountProfileId, ownerProfileId, {
		offset: page.nextOffset,
	});
	return { items: page.items, nextCursor };
}

/** Release owner-scoped retained pages/cursors when a drawer refreshes or closes. */
export function releaseCachedAlbumHistory(ownerProfileId: number): void {
	const accountProfileId = getAccountSessionSnapshot().accountId;
	if (accountProfileId === null) return;
	historyPages.closeOwner(accountProfileId, ownerProfileId);
	historyPageNextCursors.closeOwner(accountProfileId, ownerProfileId);
	historyCursors.closeOwner(accountProfileId, ownerProfileId);
}

/** Apply only after a complete, successfully parsed shares response. */
export async function reconcileCachedAlbumMembership(
	ownerProfileId: number,
	currentAlbumIds: ReadonlySet<number>,
	listedAt = Date.now(),
): Promise<void> {
	const session = getAccountSessionSnapshot();
	const accountId = session.accountId;
	if (accountId === null) return;
	const membershipSnapshot: AlbumMembershipSnapshot = {
		version: 5,
		currentAlbumIds: [...currentAlbumIds].toSorted(
			(left, right) => left - right,
		),
		listedAt,
	};
	if (
		!(await storeAlbumMembershipSnapshotRecord({
			accountId,
			ownerProfileId,
			currentAlbumIds: membershipSnapshot.currentAlbumIds,
			listedAt: membershipSnapshot.listedAt,
		}))
	)
		await writeCacheEntry(
			accountId,
			"migration",
			albumMembershipSnapshotKey(ownerProfileId),
			membershipSnapshot,
		);
	if (!isAccountSessionCurrent(session)) return;
	if (
		await reconcileAlbumRecordsMembership({
			accountId,
			ownerProfileId,
			currentAlbumIds: [...currentAlbumIds],
			listedAt,
		})
	) {
		for (const record of records.values()) {
			if (
				record?.identity.accountProfileId !== accountId ||
				record.identity.ownerProfileId !== ownerProfileId
			)
				continue;
			const reconciled = applyAuthoritativeAlbumMembership(
				record,
				membershipSnapshot,
			);
			notify(reconciled.identity, reconciled);
		}
		return;
	}
	const cachedRecords = await listCachedAlbumsByOwner(ownerProfileId);
	for (const record of reconcileAlbumMembership(
		cachedRecords,
		currentAlbumIds,
		listedAt,
	)) {
		await persist(record);
	}
}

async function persist(record: CachedAlbumRecord): Promise<void> {
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return;
	if (accountId !== record.identity.accountProfileId) return;
	if (
		await storeAlbumRecord({
			accountId,
			ownerProfileId: record.identity.ownerProfileId,
			albumId: record.identity.albumId,
			record,
		})
	) {
		notify(record.identity, record);
		return;
	}
	await writeCacheEntry(
		accountId,
		"album",
		cacheKey(record.identity.ownerProfileId, record.identity.albumId),
		record,
	);
	notify(record.identity, record);
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
	const accountId = getAccountSessionSnapshot().accountId;
	if (accountId === null) return;
	const identity = identityForDiscovery(discovery, accountId);
	if (!identity) return;
	let cached = await readCachedAlbum(identity);
	if (cached === null && discovery.ownerValidated) {
		cached = await bindOwnerlessLegacyAlbum(identity);
	}
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
	const queueKey = albumIdentityKey(identity);
	if (queued.has(queueKey)) return;
	queued.add(queueKey);
	queue.push({ discovery, identity });
	observeBackgroundTask(processQueue(), {
		category: "background_task",
		component: "album",
		code: "album_discovery_queue_failed",
	});
}

export async function markAlbumUnavailable(
	identity: SharedAlbumIdentity | number,
	reason: "revoked_or_removed" | "expired" | "views_exhausted",
): Promise<void> {
	const cached = await readCachedAlbum(identity);
	if (!cached) return;
	await persist({
		...cached,
		access: { status: "unavailable", reason, detectedAt: Date.now() },
		membership: {
			...cached.membership,
			isCurrentlyShared: false,
			unavailableReason:
				reason === "expired"
					? "expired"
					: reason === "views_exhausted"
						? "views_exhausted"
						: "unshared",
		},
	});
}

async function processQueue(): Promise<void> {
	if (processing) return;
	processing = true;
	try {
		while (queue.length > 0) {
			const queuedDiscovery = queue.shift();
			if (!queuedDiscovery) break;
			const { discovery, identity } = queuedDiscovery;
			queued.delete(albumIdentityKey(identity));
			const session = getAccountSessionSnapshot();
			if (session.accountId !== identity.accountProfileId) continue;
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
					await markAlbumUnavailable(identity, "revoked_or_removed");
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
	const identity = identityForDiscovery(discovery, accountId);
	if (!identity || album.profileId !== identity.ownerProfileId) return;
	const previous = await readCachedAlbum(identity);
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
				cacheMediaWithRetry(
					accountId,
					identity.ownerProfileId,
					album.albumId,
					item,
					maximumBytes,
				),
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
	const now = Date.now();
	const retainedItems = reconcileRetainedItems(
		previous?.retainedItems ?? [],
		album.content,
		now,
	).map((item) => {
		const cached = media.find(
			(candidate) => candidate.contentId === item.contentId,
		);
		return cached
			? { ...item, cacheToken: cached.token, byteLength: cached.byteLength }
			: item;
	});
	await persist({
		version: 2,
		albumId: album.albumId,
		ownerProfileId: identity.ownerProfileId,
		identity,
		membership: {
			isCurrentlyShared: true,
			lastListedAt: now,
			unavailableReason: null,
		},
		currentSnapshot: {
			albumName: album.albumName,
			updatedAt: album.updatedAt,
			contentFingerprint: contentFingerprint(album.content),
			orderedContentIds: album.content.map((item) => item.contentId),
		},
		retainedItems,
		historyOrder: previous?.historyOrder ?? null,
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
	ownerProfileId: number,
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
				ownerProfileId,
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
				ownerProfileId: record.identity.ownerProfileId,
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
	const identity = identityForDiscovery(discovery, accountId);
	if (!identity || album.profileId !== identity.ownerProfileId) return;
	const item = album.content.find(
		(candidate) => candidate.contentId === contentId,
	);
	if (!item || item.url.length === 0) return;
	const cached = await cacheMediaWithRetry(
		accountId,
		identity.ownerProfileId,
		album.albumId,
		item,
		getCacheSizeMbSnapshot() * 1024 * 1024,
	);
	if (!cached) return;
	const previous = await readCachedAlbum(identity);
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
	const now = Date.now();
	await persist({
		version: 2,
		albumId: album.albumId,
		ownerProfileId: identity.ownerProfileId,
		identity,
		membership: {
			isCurrentlyShared: true,
			lastListedAt: now,
			unavailableReason: null,
		},
		currentSnapshot: {
			albumName: album.albumName,
			updatedAt: album.updatedAt,
			contentFingerprint: contentFingerprint(album.content),
			orderedContentIds: album.content.map((item) => item.contentId),
		},
		retainedItems: reconcileRetainedItems(
			previous?.retainedItems ?? [],
			album.content,
			now,
		).map((retained) =>
			retained.contentId === contentId
				? {
						...retained,
						cacheToken: cached.token,
						byteLength: cached.byteLength,
					}
				: retained,
		),
		historyOrder: previous?.historyOrder ?? null,
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
	historyCursors.clear();
	historyPages.clear();
	historyPageNextCursors.clear();
	genericAlbumMigrationProgress.clear();
	albumMigrationContinuation.clear();
	processing = false;
	lastRequestStartedAt = 0;
}

registerAccountCache(clearAlbumCacheMemory);
