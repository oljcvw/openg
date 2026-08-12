import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { type Profile, profileSchema } from "$lib/model/users/profiles";
import {
	existsAppDataFile,
	readAppDataFile,
	removeAppDataFile,
	writeAppDataFileAtomic,
} from ".";
import {
	readCacheEntry,
	removeCacheEntry,
	writeCacheEntry,
} from "./cache-manager";

const FILE_NAME = "profile-cache.data";
const MAX_PROFILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const cachedProfileSchema = z.object({
	profile: profileSchema,
	updatedAt: z.number().nonnegative(),
});

const profileCacheSchema = z.object({
	version: z.literal(1).default(1),
	accounts: z
		.record(z.string(), z.record(z.string(), cachedProfileSchema))
		.default({}),
});

type ProfileCache = z.infer<typeof profileCacheSchema>;

let activeAccountProfileId: number | null = null;
let migration: Promise<void> | null = null;

export function parseProfileCache(value: unknown): ProfileCache {
	return profileCacheSchema.parse(value);
}

export function setProfileCacheAccount(profileId: number): void {
	activeAccountProfileId = profileId;
}

export function getProfileCacheAccount(): number | null {
	return activeAccountProfileId;
}

function accountKey(): string | null {
	return activeAccountProfileId === null
		? null
		: String(activeAccountProfileId);
}

async function migrateLegacyCache(): Promise<void> {
	if (migration) return await migration;
	migration = (async () => {
		const owner = accountKey();
		if (owner === null) return;
		if (!(await existsAppDataFile(FILE_NAME))) return;
		try {
			const legacy = parseProfileCache(
				decode(await readAppDataFile(FILE_NAME)),
			);
			const profiles = legacy.accounts[owner];
			if (profiles === undefined) return;
			for (const [profileId, entry] of Object.entries(profiles)) {
				await writeCacheEntry(Number(owner), "profile", profileId, entry);
			}
			delete legacy.accounts[owner];
			if (Object.keys(legacy.accounts).length > 0) {
				await writeAppDataFileAtomic(FILE_NAME, encode(legacy));
				return;
			}
		} catch (error) {
			console.error("Profile cache migration failed", error);
			return;
		}
		await removeAppDataFile(FILE_NAME);
	})();
	return await migration;
}

export async function readCachedProfile(
	profileId: number,
	now: number = Date.now(),
): Promise<Profile | null> {
	return (await readCachedProfileEntry(profileId, now))?.profile ?? null;
}

export async function readCachedProfileEntry(
	profileId: number,
	now: number = Date.now(),
): Promise<{ profile: Profile; updatedAt: number } | null> {
	const owner = accountKey();
	if (owner === null) return null;
	await migrateLegacyCache();
	const entry = await readCacheEntry(
		Number(owner),
		"profile",
		String(profileId),
		(value) => cachedProfileSchema.parse(value),
	);
	if (!entry) return null;
	if (now - entry.updatedAt > MAX_PROFILE_AGE_MS) {
		await removeCacheEntry(Number(owner), "profile", String(profileId));
		return null;
	}
	return structuredClone(entry);
}

export async function writeCachedProfile(
	profile: Profile,
	updatedAt: number = Date.now(),
): Promise<void> {
	const owner = accountKey();
	if (owner === null) return;
	await migrateLegacyCache();
	await writeCacheEntry(
		Number(owner),
		"profile",
		String(profile.profileId),
		cachedProfileSchema.parse({ profile, updatedAt }),
	);
}

export async function removeCachedProfile(profileId: number): Promise<void> {
	const owner = accountKey();
	if (owner === null) return;
	await removeCacheEntry(Number(owner), "profile", String(profileId));
}

export async function deleteActiveAccountProfileCache(): Promise<void> {
	// Account-wide cache deletion is coordinated by the logout flow.
}

export function clearProfileDiskCacheMemory(): void {
	activeAccountProfileId = null;
	migration = null;
}

registerAccountCache(clearProfileDiskCacheMemory);
