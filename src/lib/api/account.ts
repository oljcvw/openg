import z from "zod";
import { fetchRest } from "$lib/api";

export const accountPreferencesSchema = z.object({
	profileId: z.number().int().nonnegative(),
	locationSearchOptOut: z.boolean(),
	incognito: z.boolean(),
	hideViewedMe: z.boolean(),
	approximateDistance: z.boolean(),
	viewRightNowNsfw: z.boolean(),
});

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;

export type AccountPreferencesUpdate = Partial<
	Omit<AccountPreferences, "profileId">
>;

export async function getAccountPreferences() {
	return await fetchRest("/v3/me/prefs/settings", { method: "GET" }).then((res) =>
		res.jsonParsed(accountPreferencesSchema),
	);
}

export async function setAccountPreferences(preferences: AccountPreferencesUpdate) {
	return await fetchRest("/v3/me/prefs/settings", {
		method: "PUT",
		body: preferences,
	});
}

export const visitingSettingsSchema = z.object({
	setting: z.string().min(1),
});

export async function getVisitingSettings() {
	return await fetchRest("/v1/visiting/settings", { method: "GET" }).then((res) =>
		res.jsonParsed(visitingSettingsSchema),
	);
}

export async function setVisitingSettings(setting: string) {
	return await fetchRest("/v1/visiting/settings", {
		method: "PUT",
		body: { setting },
	});
}

export const homeLocationSchema = z.object({
	name: z.string(),
	lat: z.number(),
	lon: z.number(),
});

export type HomeLocationUpdate = Pick<
	z.infer<typeof homeLocationSchema>,
	"lat" | "lon"
>;

export async function getHomeLocation() {
	return await fetchRest("/v1/visiting/home", { method: "GET" }).then((res) =>
		res.jsonParsed(homeLocationSchema),
	);
}

export async function setHomeLocation(location: HomeLocationUpdate) {
	return await fetchRest("/v1/visiting/home", {
		method: "PUT",
		body: location,
	}).then((res) => res.jsonParsed(homeLocationSchema));
}

export async function validatePasswordComplexity(password: string) {
	return await fetchRest("/v3/users/password-validation", {
		method: "POST",
		body: { password },
	}).then((res) => res.jsonParsed(z.unknown()));
}

export async function updatePassword({
	currentPassword,
	newPassword,
}: {
	currentPassword: string;
	newPassword: string;
}) {
	return await fetchRest("/v3/users/update-password", {
		method: "POST",
		body: { currentPassword, newPassword },
	});
}

export async function updateEmail({
	email,
	password,
}: {
	email: string;
	password: string;
}) {
	return await fetchRest("/v3/users/email", {
		method: "POST",
		body: { email, password },
	});
}
