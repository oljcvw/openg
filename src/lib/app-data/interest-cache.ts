import z from "zod";

import {
	type TapProfile,
	tapProfileSchema,
} from "$lib/model/interest/tap-profile";
import {
	type ViewerProfile,
	viewerProfileSchema,
	type ViewPreview,
	viewPreviewSchema,
} from "$lib/model/interest/views";
import { readCacheEntry, writeCacheEntry } from "./cache-manager";

const tapsSnapshotSchema = z.object({
	version: z.literal(1).default(1),
	profiles: z.array(tapProfileSchema),
	updatedAt: z.number().nonnegative(),
});

const viewsSnapshotSchema = z.object({
	version: z.literal(1).default(1),
	profiles: z.array(viewerProfileSchema),
	previews: z.array(viewPreviewSchema),
	updatedAt: z.number().nonnegative(),
});

export type TapsSnapshot = { profiles: TapProfile[] };
export type ViewsSnapshot = {
	profiles: ViewerProfile[];
	previews: ViewPreview[];
};

export async function readCachedTaps(
	accountId: number,
): Promise<TapsSnapshot | null> {
	const cached = await readCacheEntry(accountId, "taps", "received", (value) =>
		tapsSnapshotSchema.parse(value),
	);
	return cached ? { profiles: cached.profiles } : null;
}

export async function writeCachedTaps(
	accountId: number,
	snapshot: TapsSnapshot,
): Promise<void> {
	await writeCacheEntry(
		accountId,
		"taps",
		"received",
		tapsSnapshotSchema.parse({ ...snapshot, updatedAt: Date.now() }),
	);
}

export async function readCachedViews(
	accountId: number,
): Promise<ViewsSnapshot | null> {
	const cached = await readCacheEntry(accountId, "views", "received", (value) =>
		viewsSnapshotSchema.parse(value),
	);
	return cached
		? { profiles: cached.profiles, previews: cached.previews }
		: null;
}

export async function writeCachedViews(
	accountId: number,
	snapshot: ViewsSnapshot,
): Promise<void> {
	await writeCacheEntry(
		accountId,
		"views",
		"received",
		viewsSnapshotSchema.parse({ ...snapshot, updatedAt: Date.now() }),
	);
}
