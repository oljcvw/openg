import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { demoEnabled, demoUploadChatMedia } from "$lib/demo";
import { mediaUrlSchema } from "$lib/model/media";
import { type PickedMedia, readMediaBytes } from "$lib/platform/media-picker";
import { fromBase64, toBase64 } from "$lib/util/base64";
import type { CapturedPhoto } from "$lib/app-data/media-capture";
import { type DrawerMedia, saveMediaToDrawer } from "./drawer";

const mediaUploadResponseSchema = z.object({
	mediaId: z.int(),
	url: mediaUrlSchema,
	mediaHash: z.string(),
});

export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;

export type ChatMediaUploadOptions = {
	length?: number;
	looping?: boolean;
	takenOnGrindr?: boolean;
};

export async function uploadChatMedia(
	bytes: Uint8Array<ArrayBuffer>,
	contentType: string,
	options: ChatMediaUploadOptions = {},
): Promise<MediaUploadResponse> {
	if (demoEnabled) {
		return demoUploadChatMedia(bytes, contentType);
	}
	const response = await invoke("upload_chat_media", {
		contentType,
		takenOnGrindr: options.takenOnGrindr ?? false,
		length: options.length,
		looping: options.looping,
		data: toBase64(bytes),
	});
	return mediaUploadResponseSchema.parse(response);
}

export async function addMediaToDrawer(
	media: PickedMedia,
): Promise<DrawerMedia> {
	const bytes = await readMediaBytes(media);
	const contentType = media.mimeType ?? "image/jpeg";
	const uploaded = await uploadChatMedia(bytes, contentType);
	await saveMediaToDrawer(uploaded.mediaId);

	return {
		id: uploaded.mediaId,
		url: uploaded.url,
		contentType,
		createdTs: Date.now(),
		used: false,
		takenOnGrindr: false,
	};
}

export async function addCapturedPhotoToDrawer(
	photo: CapturedPhoto,
): Promise<DrawerMedia> {
	const uploaded = await uploadChatMedia(
		new Uint8Array(fromBase64(photo.dataBase64)),
		photo.contentType,
		{ takenOnGrindr: true },
	);
	await saveMediaToDrawer(uploaded.mediaId);

	return {
		id: uploaded.mediaId,
		url: uploaded.url,
		contentType: photo.contentType,
		createdTs: Date.now(),
		used: false,
		takenOnGrindr: true,
	};
}

export async function uploadExpiringChatVideo({
	dataBase64,
	durationMs,
	looping,
}: {
	dataBase64: string;
	durationMs: number;
	looping: boolean;
}): Promise<MediaUploadResponse> {
	const response = await invoke("upload_expiring_chat_video", {
		length: durationMs,
		looping,
		data: dataBase64,
	});
	return mediaUploadResponseSchema.parse(response);
}
