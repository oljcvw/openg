import z from "zod";

import { fetchRest } from "$lib/api";
import {
	type AccountSessionSnapshot,
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
	registerAccountCache,
} from "$lib/api/account-caches";
import { ApiError } from "$lib/api/api-error";
import { getBlockedUsers } from "$lib/api/browse/blocks";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import {
	readCachedProfileEntry,
	removeCachedProfile,
	writeCachedProfile,
} from "$lib/app-data/profile-cache";
import { mediaHashPublicSchema } from "$lib/model/media";
import { rightNowAttributionStatusSchema } from "$lib/model/right-now";
import {
	genderSchema,
	type Profile,
	profileRightNowSchema,
	profileSchema,
	profileShortSchema,
	pronounSchema,
} from "$lib/model/users/profiles";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
import { now } from "$lib/util/clock";

function isProbablyUnavailable(profile: Profile) {
	const nullFields = [
		"aboutMe",
		"age",
		"ethnicity",
		"relationshipStatus",
		"bodyType",
		"sexualPosition",
		"hivStatus",
		"lastTestedDate",
		"height",
		"weight",
		"seen",
		"onlineUntil",
		"distance",
		"profileImageMediaHash",
		"identity",
		"lastChatTimestamp",
		"lastViewed",
		"nsfw",
		"lastUpdatedTime",
		"genders",
		"pronouns",
		"tapType",
	] as const satisfies readonly (keyof Profile)[];
	const falseFields = [
		"showAge",
		"showDistance",
		"approximateDistance",
		"isFavorite",
		"isNew",
		"tapped",
	] as const satisfies readonly (keyof Profile)[];
	const emptyArrayFields = [
		"grindrTribes",
		"lookingFor",
		"medias",
		"hashtags",
		"profileTags",
		"meetAt",
	] as const satisfies readonly (keyof Profile)[];
	const probablyBlocked =
		nullFields.every((field) => profile[field] === null) &&
		falseFields.every((field) => profile[field] === false) &&
		emptyArrayFields.every((field) => {
			const value = profile[field];
			return Array.isArray(value) && value.length === 0;
		}) &&
		profile.vaccines &&
		profile.vaccines.length === 0 &&
		Object.keys(profile.socialNetworks).length === 0 &&
		profile.lastReceivedTapTimestamp === null;
	return probablyBlocked;
}

export class BlockedProfileError extends Error {
	blockedByUs: boolean;

	constructor({ blockedByUs }: { blockedByUs: boolean }) {
		super("Blocked");
		this.name = "BlockedProfileError";
		this.blockedByUs = blockedByUs;
	}
}

export class ProfileUnavailableError extends Error {
	constructor() {
		super("Profile unavailable");
		this.name = "ProfileUnavailableError";
	}
}

const profileResponseSchema = z.object({
	profiles: z.array(profileSchema).length(1),
});

const profilesCache = new Map<
	number,
	{ profile: Profile; updatedAt: number }
>();

const profilesInFlight = new Map<string, Promise<Profile>>();
const profileFreshnessHints = new Map<number, number>();

function profileCacheIsFresh(
	profileId: number,
	cached: { profile: Profile; updatedAt: number },
): boolean {
	if (now() - cached.updatedAt >= 1000 * 60) return false;
	const hint = profileFreshnessHints.get(profileId);
	if (hint === undefined) return true;
	return (
		cached.profile.lastUpdatedTime !== null &&
		cached.profile.lastUpdatedTime >= hint
	);
}

export function noteProfileFreshness(
	profileId: number,
	lastUpdatedTime: number | null,
): void {
	if (lastUpdatedTime === null) return;
	const current = profileFreshnessHints.get(profileId) ?? 0;
	if (lastUpdatedTime > current) {
		profileFreshnessHints.set(profileId, lastUpdatedTime);
	}
}

export async function getProfile(profileId: number): Promise<Profile> {
	const session = getAccountSessionSnapshot();
	const cached = profilesCache.get(profileId);
	if (cached && profileCacheIsFresh(profileId, cached)) {
		return cached.profile;
	}
	const requestKey = profileRequestKey(profileId, session);
	let request = profilesInFlight.get(requestKey);
	if (!request) {
		request = fetchProfile(profileId, session).finally(() => {
			profilesInFlight.delete(requestKey);
		});
		profilesInFlight.set(requestKey, request);
	}
	return request;
}

export async function getPersistedProfile(
	profileId: number,
): Promise<Profile | null> {
	const session = getAccountSessionSnapshot();
	const cached = profilesCache.get(profileId);
	if (cached) return structuredClone(cached.profile);
	const persisted = await readCachedProfileEntry(profileId, now()).catch(() => {
		console.error("Profile cache hydration failed");
		reportClientDiagnostic({
			category: "cache_recovery",
			component: "profile",
			code: "bypassed_unreadable_cache",
			level: "warning",
		});
		return null;
	});
	assertAccountSessionCurrent(session);
	if (!persisted) return null;
	profilesCache.set(profileId, persisted);
	return structuredClone(persisted.profile);
}

export async function refreshProfile(profileId: number): Promise<Profile> {
	const session = getAccountSessionSnapshot();
	const requestKey = profileRequestKey(profileId, session);
	let request = profilesInFlight.get(requestKey);
	if (!request) {
		request = fetchProfile(profileId, session).finally(() => {
			profilesInFlight.delete(requestKey);
		});
		profilesInFlight.set(requestKey, request);
	}
	return await request;
}

const MAGIC_PROFILE_UNAVAILABLE_DISPLAY_NAME = "3";
const MAGIC_PROFILE_BLOCK_DISPLAY_NAME = "4";

async function fetchProfile(
	profileId: number,
	session: AccountSessionSnapshot,
): Promise<Profile> {
	const profile = (
		await fetchRest(`/v7/profiles/${profileId}`, {
			method: "GET",
		}).then((res) => res.jsonParsed(profileResponseSchema))
	).profiles[0];
	assertAccountSessionCurrent(session);
	if (isProbablyUnavailable(profile)) {
		if (profile.displayName === MAGIC_PROFILE_BLOCK_DISPLAY_NAME) {
			const blockedByUs = await getBlockedUsers().then((blocking) =>
				blocking.some((blocked) => blocked.profileId === profileId),
			);
			assertAccountSessionCurrent(session);
			throw new BlockedProfileError({ blockedByUs });
		} else if (profile.displayName === MAGIC_PROFILE_UNAVAILABLE_DISPLAY_NAME) {
			throw new ProfileUnavailableError();
		}
	}
	profilesCache.set(profileId, { profile, updatedAt: now() });
	void writeCachedProfile(profile, now()).catch((error: unknown) => {
		console.error("Profile cache persistence failed", error);
	});
	return profile;
}

const getProfilesResponseSchema = z.object({
	profiles: z.array(
		z.object({
			...profileShortSchema.shape,
			...profileRightNowSchema.shape,
			rightNowStatus: rightNowAttributionStatusSchema.nullish().catch("NONE"),
		}),
	),
});

export async function getProfiles(
	profileIds: number[],
): Promise<z.infer<typeof getProfilesResponseSchema>["profiles"]> {
	if (profileIds.length === 0) return [];
	const session = getAccountSessionSnapshot();
	const batchSize = Math.min(
		30,
		Math.max(1, getDeveloperSettingsSnapshot().profileResolutionBatchSize),
	);
	const requestedProfileIds = [...new Set(profileIds)];
	const profilesById = new Map<
		number,
		z.infer<typeof getProfilesResponseSchema>["profiles"][number]
	>();
	for (let index = 0; index < requestedProfileIds.length; index += batchSize) {
		const batch = requestedProfileIds.slice(index, index + batchSize);
		const resolved = await fetchRest("/v3/profiles", {
			method: "POST",
			body: { targetProfileIds: batch },
		}).then((res) => res.jsonParsed(getProfilesResponseSchema).profiles);
		for (const profile of resolved)
			profilesById.set(profile.profileId, profile);
		assertAccountSessionCurrent(session);
	}
	const profiles = requestedProfileIds.flatMap((profileId) => {
		const profile = profilesById.get(profileId);
		return profile ? [profile] : [];
	});
	for (const profile of profiles) {
		noteProfileFreshness(profile.profileId, profile.lastUpdatedTime);
	}
	return profiles;
}

let myProfileCache: {
	profile: z.infer<typeof getProfilesResponseSchema>["profiles"][0];
	updatedAt: number;
} | null = null;

export async function getMyProfile() {
	if (myProfileCache && now() - myProfileCache.updatedAt < 1000 * 60) {
		return myProfileCache.profile;
	}
	const session = getAccountSessionSnapshot();
	const profile = await fetchRest("/v4/me/profile").then(
		(res) => res.jsonParsed(getProfilesResponseSchema).profiles[0],
	);
	assertAccountSessionCurrent(session);
	myProfileCache = { profile, updatedAt: now() };
	return profile;
}

export function clearProfileCaches() {
	myProfileCache = null;
	profilesCache.clear();
	profilesInFlight.clear();
	profileFreshnessHints.clear();
}

registerAccountCache(clearProfileCaches);

function profileRequestKey(
	profileId: number,
	session: AccountSessionSnapshot,
): string {
	return `${session.generation}:${profileId}`;
}

function assertAccountSessionCurrent(session: AccountSessionSnapshot): void {
	if (!isAccountSessionCurrent(session)) {
		throw new DOMException("Account session changed", "AbortError");
	}
}

export function invalidateProfile(profileId: number) {
	profilesCache.delete(profileId);
	void removeCachedProfile(profileId).catch((error: unknown) => {
		console.error("Profile cache invalidation failed", error);
	});
	if (myProfileCache?.profile.profileId === profileId) {
		myProfileCache = null;
	}
}

export type ProfileEdit = Partial<
	Pick<
		Profile,
		| "displayName"
		| "age"
		| "showAge"
		| "showDistance"
		| "aboutMe"
		| "ethnicity"
		| "relationshipStatus"
		| "bodyType"
		| "hivStatus"
		| "sexualPosition"
		| "nsfw"
		| "showTribes"
		| "showPosition"
		| "grindrTribes"
		| "tribesImInto"
		| "lookingFor"
		| "meetAt"
		| "vaccines"
		| "sexualHealth"
		| "genders"
		| "pronouns"
		| "lastTestedDate"
		| "socialNetworks"
		| "height"
		| "weight"
	>
>;

export type ProfileUpdate = ProfileEdit &
	Pick<Profile, "approximateDistance" | "profileTags">;

export function applyProfileEdit(
	base: Profile,
	patch: Partial<Profile>,
): Profile {
	const merged = { ...base, ...patch };
	if (patch.socialNetworks) {
		merged.socialNetworks = { ...base.socialNetworks, ...patch.socialNetworks };
	}
	return merged;
}

export function mergeProfileEditIntoCaches(
	cacheProfileId: number,
	patch: Partial<Profile>,
) {
	const cached = profilesCache.get(cacheProfileId);
	if (cached) {
		const profile = applyProfileEdit(cached.profile, patch);
		profilesCache.set(cacheProfileId, {
			profile,
			updatedAt: now(),
		});
		void writeCachedProfile(profile, now()).catch((error: unknown) => {
			console.error("Profile cache persistence failed", error);
		});
	}
	if (myProfileCache && myProfileCache.profile.profileId === cacheProfileId) {
		const next: Record<string, unknown> = { ...myProfileCache.profile };
		for (const key of Object.keys(patch)) {
			if (key in next) next[key] = patch[key as keyof Profile];
		}
		myProfileCache = {
			profile: next as typeof myProfileCache.profile,
			updatedAt: now(),
		};
	}
}

export async function patchOwnProfile(
	cacheProfileId: number,
	patch: ProfileEdit,
) {
	const res = await fetchRest("/v4/me/profile", {
		method: "PATCH",
		body: patch,
	});
	res.assertOk();
	mergeProfileEditIntoCaches(cacheProfileId, patch);
}

const bannedTermsSchema = z
	.object({ terms: z.array(z.string()).nullish() })
	.nullish();

const bannedTermsErrorSchema = z.object({
	type: z.literal("urn:gr:err:hit_banned_terms"),
	display_name: bannedTermsSchema,
	about_me: bannedTermsSchema,
	gender_display: bannedTermsSchema,
	pronouns_display: bannedTermsSchema,
});

const moderatedFieldKeys = [
	"display_name",
	"about_me",
	"gender_display",
	"pronouns_display",
] as const;

const moderatedFieldLabels: Record<
	(typeof moderatedFieldKeys)[number],
	string
> = {
	display_name: "Display name",
	about_me: "About me",
	gender_display: "Gender",
	pronouns_display: "Pronouns",
};

export type ModeratedField = { field: string; terms: string[] };

export class ProfileModerationError extends Error {
	rejected: ModeratedField[];

	constructor(rejected: ModeratedField[]) {
		super(`Banned terms in: ${rejected.map((r) => r.field).join(", ")}`);
		this.name = "ProfileModerationError";
		this.rejected = rejected;
	}
}

function readBannedTerms(body: string): ModeratedField[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	const result = bannedTermsErrorSchema.safeParse(parsed);
	if (!result.success) return null;
	return moderatedFieldKeys
		.map((key) => ({
			field: moderatedFieldLabels[key],
			terms: result.data[key]?.terms ?? [],
		}))
		.filter((entry) => entry.terms.length > 0);
}

export async function updateOwnProfile(
	cacheProfileId: number,
	profile: ProfileUpdate,
) {
	const res = await fetchRest("/v3.1/me/profile", {
		method: "PUT",
		body: profile,
	});

	if (res.status === 200) {
		mergeProfileEditIntoCaches(cacheProfileId, profile);
		return;
	}

	const body = res.text();
	const rejected = readBannedTerms(body);
	if (rejected !== null) {
		throw new ProfileModerationError(rejected);
	}

	res.assertOk();
	throw new ApiError({
		message: `Unexpected ${res.status} response from profile update`,
		request: { method: "PUT", path: "/v3.1/me/profile", body: profile },
		response: { status: res.status, body },
	});
}

export async function deleteProfilePhotos(
	cacheProfileId: number,
	mediaHashes: string[],
) {
	if (mediaHashes.length === 0) return;
	const res = await fetchRest("/v3/me/profile/images", {
		method: "DELETE",
		body: { media_hashes: mediaHashes },
	});
	res.assertOk();
	const removed = new Set(mediaHashes);
	const cached = profilesCache.get(cacheProfileId);
	if (cached) {
		profilesCache.set(cacheProfileId, {
			profile: {
				...cached.profile,
				medias: cached.profile.medias.filter((m) => !removed.has(m.mediaHash)),
			},
			updatedAt: now(),
		});
	}
	if (myProfileCache && myProfileCache.profile.profileId === cacheProfileId) {
		myProfileCache = {
			profile: {
				...myProfileCache.profile,
				medias: myProfileCache.profile.medias.filter(
					(m) => !removed.has(m.mediaHash),
				),
			},
			updatedAt: now(),
		};
	}
}

const gendersResponseSchema = z.array(genderSchema);

export async function getGenders() {
	return await fetchRest("/public/v2/genders").then((res) =>
		res.jsonParsed(gendersResponseSchema),
	);
}

const pronounsResponseSchema = z.array(pronounSchema);

export async function getPronouns() {
	return await fetchRest("/v1/pronouns").then((res) =>
		res.jsonParsed(pronounsResponseSchema),
	);
}

export async function getProfileUploadedPhotos() {
	return await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(
			z.object({
				medias: z.array(
					z.object({
						mediaHash: mediaHashPublicSchema,
						type: z.int(),
						state: z.int(),
					}),
				),
			}),
		),
	);
}
