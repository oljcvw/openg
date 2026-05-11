import z from "zod";
import { fetchRest } from "$lib/api";
import { viewSourceEnumSchema } from "$lib/model/interest";

export const TapType = {
	Friendly: 0,
	Hot: 1,
	Looking: 2,
	None: 3,
} as const;

export const tapTypeSchema = z.union([
	z.literal(TapType.Friendly),
	z.literal(TapType.Hot),
	z.literal(TapType.Looking),
	z.literal(TapType.None),
]);

export type TapTypeId = z.infer<typeof tapTypeSchema>;

const favoriteNoteSchema = z.object({
	notes: z.string(),
	phoneNumber: z.string(),
});

const favoriteNoteListItemSchema = favoriteNoteSchema.extend({
	counterpartyId: z.coerce.number().int().nonnegative(),
});

const blockedProfilesResponseSchema = z.object({
	blocking: z.array(
		z.object({
			profileId: z.coerce.number().int().nonnegative(),
			blockedTime: z.number().int().nonnegative(),
		}),
	),
});

const hiddenProfilesResponseSchema = z.object({
	hides: z.array(
		z.object({
			profileId: z.coerce.number().int().nonnegative(),
			displayName: z.string(),
			mediaHash: z.string(),
		}),
	),
});

const receivedTapsResponseSchema = z.object({
	profiles: z.array(
		z
			.object({
				timestamp: z.number().int().nonnegative().optional(),
				tapType: tapTypeSchema.optional(),
			})
			.passthrough(),
	),
});

const sentTapSchema = z.object({
	senderId: z.coerce.number().int().nonnegative(),
	receiverId: z.coerce.number().int().nonnegative(),
	tapType: tapTypeSchema,
	sentOn: z.number().int().nonnegative(),
	deleted: z.boolean(),
	readOn: z.unknown().nullable(),
});

export async function addFavorite(profileId: number): Promise<void> {
	await fetchRest(`/v3/me/favorites/${profileId}`, { method: "POST" });
}

export async function removeFavorite(profileId: number): Promise<void> {
	await fetchRest(`/v3/me/favorites/${profileId}`, { method: "DELETE" });
}

export async function getFavoriteNotes() {
	return await fetchRest("/v1/favorites/notes", { method: "GET" }).then((res) =>
		res.jsonParsed(z.array(favoriteNoteListItemSchema)),
	);
}

export async function getFavoriteNote(profileId: number) {
	return await fetchRest(`/v1/favorites/notes/${profileId}`, {
		method: "GET",
	}).then((res) => res.jsonParsed(favoriteNoteSchema));
}

export async function updateFavoriteNote({
	profileId,
	notes,
	phoneNumber,
}: {
	profileId: number;
	notes: string;
	phoneNumber: string;
}): Promise<void> {
	await fetchRest(`/v1/favorites/notes/${profileId}`, {
		method: "PUT",
		body: { notes, phoneNumber },
	});
}

export async function deleteFavoriteNote(profileId: number): Promise<void> {
	await fetchRest(`/v1/favorites/notes/${profileId}`, { method: "DELETE" });
}

export async function getBlockedProfiles() {
	return await fetchRest("/v3.1/me/blocks", { method: "GET" })
		.then((res) => res.jsonParsed(blockedProfilesResponseSchema))
		.then((res) => res.blocking);
}

export async function blockProfile(profileId: number): Promise<void> {
	await fetchRest(`/v3/me/blocks/${profileId}`, { method: "POST" });
}

export async function unblockProfile(profileId: number): Promise<void> {
	await fetchRest(`/v3/me/blocks/${profileId}`, { method: "DELETE" });
}

export async function unblockAllProfiles(): Promise<void> {
	await fetchRest("/v3/me/blocks", { method: "DELETE" });
}

export async function getHiddenProfiles() {
	return await fetchRest("/v1/hides", { method: "GET" })
		.then((res) => res.jsonParsed(hiddenProfilesResponseSchema))
		.then((res) => res.hides);
}

export async function hideProfile(profileId: number): Promise<void> {
	await fetchRest(`/v1/me/hides/${profileId}`, { method: "POST" });
}

export async function unhideProfile(profileId: number): Promise<void> {
	await fetchRest(`/v1/hides/${profileId}`, { method: "DELETE" });
}

export async function unhideAllProfiles(): Promise<void> {
	await fetchRest("/v1/hides", { method: "DELETE" });
}

export async function sendTap({
	recipientId,
	tapType,
}: {
	recipientId: number;
	tapType: TapTypeId;
}): Promise<void> {
	await fetchRest("/v2/taps/add", {
		method: "POST",
		body: { recipientId, tapType },
	});
}

export async function getReceivedTaps() {
	return await fetchRest("/v2/taps/received", { method: "GET" }).then((res) =>
		res.jsonParsed(receivedTapsResponseSchema),
	);
}

export async function getSentTaps() {
	return await fetchRest("/v1/interactions/taps/sent", { method: "GET" }).then(
		(res) => res.jsonParsed(z.array(sentTapSchema)),
	);
}

export async function recordProfileView({
	profileId,
	foundVia,
	source,
}: {
	profileId: number;
	foundVia: unknown | null;
	source: z.infer<typeof viewSourceEnumSchema>;
}): Promise<void> {
	await fetchRest(`/v5/views/${profileId}`, {
		method: "POST",
		body: { foundVia, source },
	});
}

export async function recordProfileViews({
	profileIds,
	foundVia,
}: {
	profileIds: number[];
	foundVia: unknown | null;
}): Promise<void> {
	await fetchRest("/v4/views", {
		method: "POST",
		body: {
			viewedProfileIds: profileIds.map(String),
			foundVia,
		},
	});
}
