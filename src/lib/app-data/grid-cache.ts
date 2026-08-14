import { decode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import {
	readCacheEntry,
	removeCacheEntry,
	writeCacheEntry,
} from "$lib/app-data/cache-manager";
import { getProfileCacheAccount } from "$lib/app-data/profile-cache";
import { cascadeV4QuerySchema } from "$lib/model/browse/grid/cascade/query/v4";
import { existsAppDataFile, readAppDataFile, removeAppDataFile } from ".";

const FILE_NAME = "grid-cache.data";
const MAX_GRID_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_GRIDS_PER_ACCOUNT = 8;

const renderedGridProfileSchema = z.object({
	type: z.literal("rendered"),
	id: z.number().int().nonnegative(),
	displayName: z.string().nullable(),
	distance: z.number().nullable(),
	profilePhotosHashes: z.array(z.string()).nullable(),
	unread: z.number().nullable(),
	onlineUntil: z.number().nullable(),
	isFavorite: z.boolean(),
	isRightNow: z.boolean(),
	isVisiting: z.boolean(),
	hasChattedInLast24Hrs: z.boolean(),
});

const lazyGridProfileSchema = z.object({
	type: z.literal("lazy"),
	id: z.number().int().nonnegative(),
	unread: z.number().nullable(),
	isVisiting: z.boolean(),
});

export const cachedGridProfileSchema = z.discriminatedUnion("type", [
	renderedGridProfileSchema,
	lazyGridProfileSchema,
]);

export function normalizePersistedGridQuery(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	return Object.fromEntries(
		Object.entries(value).filter(
			([, property]) => property !== undefined && property !== null,
		),
	);
}

const persistedGridQuerySchema = z.preprocess(
	normalizePersistedGridQuery,
	cascadeV4QuerySchema,
);

const cachedGridSchema = z.object({
	query: persistedGridQuerySchema,
	items: z.array(cachedGridProfileSchema),
	nextPage: z.number().nullable(),
	updatedAt: z.number().nonnegative(),
});

const gridCacheSchema = z.object({
	version: z.literal(1).default(1),
	accounts: z
		.record(z.string(), z.record(z.string(), cachedGridSchema))
		.default({}),
});

export type CachedGridProfile = z.infer<typeof cachedGridProfileSchema>;
export type CachedGrid = z.infer<typeof cachedGridSchema>;
type GridCache = z.infer<typeof gridCacheSchema>;

let migration: Promise<void> | null = null;

export function parseGridCache(value: unknown): GridCache {
	return gridCacheSchema.parse(value);
}

function ownerKey(): string | null {
	const profileId = getProfileCacheAccount();
	return profileId === null ? null : String(profileId);
}

function queryKey(query: z.infer<typeof cascadeV4QuerySchema>): string {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(query)
				.filter(([, value]) => value !== undefined)
				.toSorted(([left], [right]) => left.localeCompare(right)),
		),
	);
}

async function migrateLegacyCache(): Promise<void> {
	if (migration) return await migration;
	migration = (async () => {
		if (!(await existsAppDataFile(FILE_NAME))) return;
		try {
			const legacy = parseGridCache(decode(await readAppDataFile(FILE_NAME)));
			for (const [accountId, grids] of Object.entries(legacy.accounts)) {
				await writeCacheEntry(Number(accountId), "grid", "grids", grids);
			}
		} catch {
			console.error("Browse cache migration failed");
			return;
		}
		await removeAppDataFile(FILE_NAME);
	})();
	return await migration;
}

async function getAccountCache(
	owner: string,
): Promise<Record<string, CachedGrid>> {
	await migrateLegacyCache();
	return (
		(await readCacheEntry(Number(owner), "grid", "grids", (value) =>
			z.record(z.string(), cachedGridSchema).parse(value),
		)) ?? {}
	);
}

export async function readCachedGrid(
	query: z.infer<typeof cascadeV4QuerySchema>,
	now: number = Date.now(),
): Promise<CachedGrid | null> {
	const owner = ownerKey();
	if (owner === null) return null;
	const entry = (await getAccountCache(owner))[queryKey(query)];
	if (!entry || now - entry.updatedAt > MAX_GRID_AGE_MS) return null;
	return structuredClone(entry);
}

export async function writeCachedGrid(
	grid: Omit<CachedGrid, "updatedAt">,
	updatedAt: number = Date.now(),
): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	const account = await getAccountCache(owner);
	const query = cascadeV4QuerySchema.parse(
		normalizePersistedGridQuery(grid.query),
	);
	account[queryKey(query)] = { ...grid, query, updatedAt };
	for (const [key] of Object.entries(account)
		.toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
		.slice(MAX_GRIDS_PER_ACCOUNT)) {
		delete account[key];
	}
	await writeCacheEntry(Number(owner), "grid", "grids", account);
}

export async function deleteActiveAccountGridCache(): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	await removeCacheEntry(Number(owner), "grid", "grids");
}

export async function updateCachedGridProfile(
	profileId: number,
	patch: Partial<Pick<CachedGridProfile & { type: "rendered" }, "isFavorite">>,
): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	const account = await getAccountCache(owner);
	let changed = false;
	for (const grid of Object.values(account)) {
		for (const item of grid.items) {
			if (item.id !== profileId || item.type !== "rendered") continue;
			Object.assign(item, patch);
			changed = true;
		}
	}
	if (!changed) return;
	await writeCacheEntry(Number(owner), "grid", "grids", account);
}

export function clearGridDiskCacheMemory(): void {
	migration = null;
}

registerAccountCache(clearGridDiskCacheMemory);
