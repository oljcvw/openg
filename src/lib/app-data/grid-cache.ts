import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { getProfileCacheAccount } from "$lib/app-data/profile-cache";
import { cascadeV4QuerySchema } from "$lib/model/browse/grid/cascade/query/v4";
import { existsAppDataFile, readAppDataFile, writeAppDataFileAtomic } from ".";

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

const cachedGridSchema = z.object({
	query: cascadeV4QuerySchema,
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

let cache: GridCache | null = null;
let hydrating: Promise<GridCache> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let generation = 0;

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

async function readFromDisk(): Promise<GridCache> {
	if (!(await existsAppDataFile(FILE_NAME))) return parseGridCache({});
	return parseGridCache(decode(await readAppDataFile(FILE_NAME)));
}

async function getCache(): Promise<GridCache> {
	if (cache !== null) return cache;
	const currentGeneration = generation;
	hydrating ??= readFromDisk()
		.catch((error: unknown) => {
			console.error("Browse cache hydration failed", error);
			return parseGridCache({});
		})
		.then((value) => {
			if (currentGeneration === generation) cache = value;
			return value;
		})
		.finally(() => {
			if (currentGeneration === generation) hydrating = null;
		});
	return await hydrating;
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = writeQueue.then(task);
	writeQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

export async function readCachedGrid(
	query: z.infer<typeof cascadeV4QuerySchema>,
	now: number = Date.now(),
): Promise<CachedGrid | null> {
	const owner = ownerKey();
	if (owner === null) return null;
	const entry = (await getCache()).accounts[owner]?.[queryKey(query)];
	if (!entry || now - entry.updatedAt > MAX_GRID_AGE_MS) return null;
	return structuredClone(entry);
}

export async function writeCachedGrid(
	grid: Omit<CachedGrid, "updatedAt">,
	updatedAt: number = Date.now(),
): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		const account = (next.accounts[owner] ??= {});
		account[queryKey(grid.query)] = { ...grid, updatedAt };
		for (const [key] of Object.entries(account)
			.toSorted(([, left], [, right]) => right.updatedAt - left.updatedAt)
			.slice(MAX_GRIDS_PER_ACCOUNT)) {
			delete account[key];
		}
		const validated = parseGridCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export async function deleteActiveAccountGridCache(): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		delete next.accounts[owner];
		const validated = parseGridCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export async function updateCachedGridProfile(
	profileId: number,
	patch: Partial<Pick<CachedGridProfile & { type: "rendered" }, "isFavorite">>,
): Promise<void> {
	const owner = ownerKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		const account = next.accounts[owner];
		if (!account) return;
		let changed = false;
		for (const grid of Object.values(account)) {
			for (const item of grid.items) {
				if (item.id !== profileId || item.type !== "rendered") continue;
				Object.assign(item, patch);
				changed = true;
			}
		}
		if (!changed) return;
		const validated = parseGridCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export function clearGridDiskCacheMemory(): void {
	generation += 1;
	cache = null;
	hydrating = null;
}

registerAccountCache(clearGridDiskCacheMemory);
