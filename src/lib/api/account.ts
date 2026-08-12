import z from "zod";

import { fetchRest } from "$lib/api";

export const accountPreferencesSchema = z.object({
	profileId: z.coerce.number().int().nonnegative(),
	locationSearchOptOut: z.boolean(),
	incognito: z.boolean(),
	hideViewedMe: z.boolean(),
	approximateDistance: z.boolean(),
	viewRightNowNsfw: z.boolean(),
	mapLocationFuzzRadius: z.number().int().nullable().optional(),
	showOnMap: z.boolean().optional(),
});

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export type AccountPreferencesUpdate = Partial<
	Omit<AccountPreferences, "profileId">
>;

export async function getAccountPreferences(): Promise<AccountPreferences> {
	return fetchRest("/v3/me/prefs/settings", { method: "GET" }).then(
		(response) => response.jsonParsed(accountPreferencesSchema),
	);
}

export async function setAccountPreferences(
	settings: AccountPreferencesUpdate,
): Promise<void> {
	const response = await fetchRest("/v3/me/prefs/settings", {
		method: "PUT",
		body: { settings },
	});
	response.assertOk();
}
