import z from "zod";
import { fetchRest } from "$lib/api";
import { createJsonCache } from "$lib/cache/json-cache";
import {
	profileRightNowSchema,
	profileSchema,
	profileShortSchema,
	type Profile,
} from "$lib/model/profile";
import { mediaHashPublicSchema } from "$lib/model/media";

const profileResponseSchema = z.object({
	profiles: z.array(profileSchema).length(1),
});

const profilesCache = createJsonCache({
	namespace: "profiles:v1",
	schema: profileSchema,
	ttlMs: 1000 * 60,
});

export async function getProfile(profileId: number) {
	const cacheKey = String(profileId);
	const cached = await profilesCache.get(cacheKey);
	if (cached) return cached;

	const profile = (
		await fetchRest(`/v7/profiles/${profileId}`, {
			method: "GET",
		}).then((res) => res.jsonParsed(profileResponseSchema))
	).profiles[0];

	await profilesCache.set(cacheKey, profile);
	return profile;
}

const getProfilesResponseSchema = z.object({
	profiles: z.array(
		z.object({
			...profileShortSchema.shape,
			...profileRightNowSchema.shape,
		}),
	),
});

export async function getProfiles(
	profileIds: number[],
): Promise<z.infer<typeof getProfilesResponseSchema>["profiles"]> {
	if (profileIds.length === 0) return [];
	return await fetchRest("/v3/profiles", {
		method: "POST",
		body: {
			targetProfileIds: profileIds,
		},
	}).then((res) => res.jsonParsed(getProfilesResponseSchema).profiles);
}

export async function getMyProfile() {
	return await fetchRest("/v4/me/profile").then(
		(res) => res.jsonParsed(getProfilesResponseSchema).profiles[0],
	);
}

export async function getProfileUploadedPhotos() {
	return await fetchRest("/v3.1/me/profile/images").then((res) =>
		res.jsonParsed(
			z.object({
				medias: z.array(
					z.object({
						mediaHash: mediaHashPublicSchema,
						type: z.number().int(),
						state: z.number().int(),
					}),
				),
			}),
		),
	);
}
