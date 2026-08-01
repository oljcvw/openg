import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { type Profile, profileSchema } from "$lib/model/users/profiles";
import { existsAppDataFile, readAppDataFile, writeAppDataFileAtomic } from ".";

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
let cache: ProfileCache | null = null;
let hydrating: Promise<ProfileCache> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let generation = 0;

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

async function readFromDisk(): Promise<ProfileCache> {
	if (!(await existsAppDataFile(FILE_NAME))) return parseProfileCache({});
	return parseProfileCache(decode(await readAppDataFile(FILE_NAME)));
}

async function getCache(): Promise<ProfileCache> {
	if (cache !== null) return cache;
	const currentGeneration = generation;
	hydrating ??= readFromDisk()
		.catch((error: unknown) => {
			console.error("Profile cache hydration failed", error);
			return parseProfileCache({});
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

export async function readCachedProfile(
	profileId: number,
	now: number = Date.now(),
): Promise<Profile | null> {
	const owner = accountKey();
	if (owner === null) return null;
	const entry = (await getCache()).accounts[owner]?.[String(profileId)];
	if (!entry || now - entry.updatedAt > MAX_PROFILE_AGE_MS) return null;
	return structuredClone(entry.profile);
}

export async function writeCachedProfile(
	profile: Profile,
	updatedAt: number = Date.now(),
): Promise<void> {
	const owner = accountKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		next.accounts[owner] ??= {};
		next.accounts[owner][String(profile.profileId)] = { profile, updatedAt };
		const validated = parseProfileCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export async function removeCachedProfile(profileId: number): Promise<void> {
	const owner = accountKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		delete next.accounts[owner]?.[String(profileId)];
		const validated = parseProfileCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export async function deleteActiveAccountProfileCache(): Promise<void> {
	const owner = accountKey();
	if (owner === null) return;
	await enqueueWrite(async () => {
		const currentGeneration = generation;
		const next = structuredClone(await getCache());
		delete next.accounts[owner];
		const validated = parseProfileCache(next);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (currentGeneration === generation) cache = validated;
	});
}

export function clearProfileDiskCacheMemory(): void {
	generation += 1;
	activeAccountProfileId = null;
	cache = null;
	hydrating = null;
}

registerAccountCache(clearProfileDiskCacheMemory);
