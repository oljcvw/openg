import z from "zod";

import { fetchRest } from "$lib/api";
import { registerAccountCache } from "$lib/api/account-caches";

const hiddenProfileSchema = z.object({
	profileId: z.coerce.number().int().nonnegative(),
	displayName: z.string().catch(""),
	mediaHash: z.string().nullable().catch(null),
});

const hiddenProfilesSchema = z.object({
	hides: z.array(hiddenProfileSchema),
});

export type HiddenProfile = z.infer<typeof hiddenProfileSchema>;

let cache: Promise<HiddenProfile[]> | null = null;
registerAccountCache(() => {
	cache = null;
});

export function getHiddenProfiles(): Promise<HiddenProfile[]> {
	cache ??= fetchRest("/v1/hides", { method: "GET" })
		.then((response) => response.jsonParsed(hiddenProfilesSchema).hides)
		.catch((error) => {
			cache = null;
			throw error;
		});
	return cache;
}

export async function unhideProfile(profileId: number): Promise<void> {
	const response = await fetchRest(`/v1/hides/${profileId}`, {
		method: "DELETE",
	});
	response.assertOk();
	cache = null;
}

export async function unhideAllProfiles(): Promise<void> {
	const response = await fetchRest("/v1/hides", { method: "DELETE" });
	response.assertOk();
	cache = null;
}
