import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { fetchRest } from "$lib/api";
import { demoEnabled, demoUploadAlbumMedia } from "$lib/demo";
import {
	albumContentSchema,
	albumDetailsSchema,
	type AlbumExpirationType,
	albumMinSchema,
	albumSharesSchema,
	albumStorageLimitsSchema,
	myAlbumSchema,
	sharedAlbumSchema,
} from "$lib/model/messaging/albums";
import { type PickedMedia, readMediaBytes } from "$lib/platform/media-picker";
import { toBase64 } from "$lib/util/base64";

export const albumContentResponseSchema = z.object({
	...albumMinSchema.shape,
	...albumDetailsSchema.shape,
	content: z.array(
		z.object({
			...albumContentSchema.shape,
			remainingViews: z.int().optional(),
		}),
	),
});

export async function getAlbumContent(
	albumId: number,
	options: { signal?: AbortSignal } = {},
) {
	return await fetchRest(`/v2/albums/${albumId}`, {
		signal: options.signal,
	}).then((res) => res.jsonParsed(albumContentResponseSchema));
}

export type AlbumContentResponse = Awaited<ReturnType<typeof getAlbumContent>>;

const albumContentViewResponseSchema = z.object({
	remainingViews: z.int(),
});

export async function recordAlbumContentView({
	albumId,
	contentId,
}: {
	albumId: number;
	contentId: number;
}) {
	return await fetchRest(`/v1/albums/${albumId}/view/content/${contentId}`, {
		method: "POST",
	}).then((res) => res.jsonParsed(albumContentViewResponseSchema));
}

const albumNameResponseSchema = z.object({
	albumId: z.int(),
	albumName: z.string().nullable(),
});

/**
 * Creates an empty album. Throws with a 402 response once the account is at its
 * {@link getAlbumLimits} album cap.
 */
export async function createAlbum({ albumName }: { albumName: string | null }) {
	const res = await fetchRest("/v2/albums", {
		method: "POST",
		body: { albumName },
	});
	// Asserted before parsing so the documented 402 surfaces as an HTTP error
	// rather than a schema-validation failure against the error body.
	res.assertOk();
	return res.jsonParsed(albumNameResponseSchema);
}

export async function renameAlbum({
	albumId,
	albumName,
}: {
	albumId: number;
	albumName: string | null;
}) {
	const res = await fetchRest(`/v2/albums/${albumId}`, {
		method: "PUT",
		body: { albumName },
	});
	res.assertOk();
	return res.jsonParsed(albumNameResponseSchema);
}

/** Deleting an album that is already gone answers 403, not 404. */
export async function deleteAlbum({ albumId }: { albumId: number }) {
	return await fetchRest(`/v1/albums/${albumId}`, {
		method: "DELETE",
	}).then((res) => res.assertOk());
}

/**
 * Replaces the album's content order. Every existing content id must appear
 * exactly once, so callers pass the full list rather than a delta.
 */
export async function reorderAlbumContent({
	albumId,
	contentIds,
}: {
	albumId: number;
	contentIds: number[];
}) {
	return await fetchRest(`/v1/albums/${albumId}/content/order`, {
		method: "POST",
		body: { contentIds },
	}).then((res) => res.assertOk());
}

export async function deleteAlbumContent({
	albumId,
	contentId,
}: {
	albumId: number;
	contentId: number;
}) {
	return await fetchRest(`/v1/albums/${albumId}/content/${contentId}`, {
		method: "DELETE",
	}).then((res) => res.assertOk());
}

const albumMediaUploadResponseSchema = z.object({
	contentId: z.int(),
	contentUrl: z.string().nullable(),
});

export type AlbumMediaUploadResponse = z.infer<
	typeof albumMediaUploadResponseSchema
>;

export async function uploadAlbumMedia({
	albumId,
	media,
	maxBytes,
}: {
	albumId: number;
	media: PickedMedia;
	maxBytes: number;
}): Promise<AlbumMediaUploadResponse> {
	const contentType = media.mimeType;
	if (
		contentType !== "image/jpeg" &&
		contentType !== "image/png" &&
		contentType !== "video/mp4" &&
		contentType !== "video/webm"
	) {
		throw new Error("Unsupported or unknown album media type");
	}
	const bytes = await readMediaBytes(media);
	if (bytes.length === 0) throw new Error("Selected media is empty");
	if (bytes.length > maxBytes) {
		throw new Error(
			`Selected media exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB album limit`,
		);
	}
	if (demoEnabled) {
		return demoUploadAlbumMedia(albumId, bytes, contentType);
	}
	const response = await invoke("upload_album_media", {
		albumId,
		contentType,
		data: toBase64(bytes),
	});
	return albumMediaUploadResponseSchema.parse(response);
}

/** The profiles an album is currently shared with. */
export async function getAlbumShares(albumId: number) {
	const { profileIds } = await fetchRest(`/v1/albums/${albumId}/shares`).then(
		(res) => res.jsonParsed(albumSharesSchema),
	);
	return profileIds ?? [];
}

/**
 * Revokes an album share.
 *
 * `GET .../shares` returns profile ids but no per-share id. The current API
 * contract requires the field and explicitly defines `0` as the sentinel when
 * a concrete share id is unavailable.
 */
export async function unshareAlbum({
	albumId,
	profileIds,
}: {
	albumId: number;
	profileIds: number[];
}) {
	return await fetchRest(`/v1/albums/${albumId}/unshares`, {
		method: "PUT",
		body: {
			profiles: profileIds.map((profileId) => ({ profileId, shareId: 0 })),
		},
	}).then((res) => res.assertOk());
}

const sharedAlbumsResponseSchema = z.object({
	albums: z.array(sharedAlbumSchema),
});

/** Albums the given profile has shared with us. */
export async function getAlbumsSharedByProfile(profileId: number) {
	const { albums } = await fetchRest(`/v2/albums/shares/${profileId}`).then(
		(res) => res.jsonParsed(sharedAlbumsResponseSchema),
	);
	return albums;
}

export async function getAlbumLimits() {
	return await fetchRest("/v1/albums/storage").then((res) =>
		res.jsonParsed(albumStorageLimitsSchema),
	);
}

const myAlbumsResponseSchema = z.object({
	albums: z.array(myAlbumSchema),
});

export async function getMyAlbums() {
	const { albums } = await fetchRest("/v1/albums").then((res) =>
		res.jsonParsed(myAlbumsResponseSchema),
	);
	return albums;
}

/**
 * Shares an album with the given profiles. The API automatically sends the
 * shared album to the chat with every listed profile.
 */
export async function shareAlbum({
	albumId,
	profileIds,
	expirationType,
}: {
	albumId: number;
	profileIds: number[];
	expirationType: AlbumExpirationType;
}) {
	return await fetchRest(`/v4/albums/${albumId}/shares`, {
		method: "POST",
		body: {
			profiles: profileIds.map((profileId) => ({ profileId, expirationType })),
		},
	}).then((res) => res.assertOk());
}
