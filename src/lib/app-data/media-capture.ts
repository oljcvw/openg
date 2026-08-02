import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";

const cancelledCaptureSchema = z.object({ status: z.literal("cancelled") });

const capturedPhotoSchema = z.object({
	status: z.literal("ready"),
	dataBase64: z.string().min(1),
	contentType: z.literal("image/jpeg"),
	byteLength: z.number().int().positive(),
	width: z.number().int().positive().max(1_024),
	height: z.number().int().positive().max(1_024),
});

const capturedShortVideoSchema = z.object({
	status: z.literal("ready"),
	dataBase64: z.string().min(1),
	contentType: z.literal("video/mp4"),
	durationMs: z.number().int().min(1).max(15_000),
	fileCacheKey: z.string().min(1),
	byteLength: z.number().int().positive(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	hasAudio: z.boolean(),
});

const photoCaptureResultSchema = z.discriminatedUnion("status", [
	cancelledCaptureSchema,
	capturedPhotoSchema,
]);

const shortVideoCaptureResultSchema = z.discriminatedUnion("status", [
	cancelledCaptureSchema,
	capturedShortVideoSchema,
]);

export type CapturedPhoto = z.infer<typeof capturedPhotoSchema>;
export type CapturedShortVideo = z.infer<typeof capturedShortVideoSchema>;
export type PhotoCaptureResult = z.infer<typeof photoCaptureResultSchema>;
export type ShortVideoCaptureResult = z.infer<
	typeof shortVideoCaptureResultSchema
>;

export async function capturePhoto(): Promise<PhotoCaptureResult> {
	try {
		return photoCaptureResultSchema.parse(await invoke("media_capture_photo"));
	} catch (error) {
		if (isCancelled(error)) return { status: "cancelled" };
		throw error;
	}
}

export async function captureShortVideo(): Promise<ShortVideoCaptureResult> {
	try {
		return shortVideoCaptureResultSchema.parse(
			await invoke("media_capture_short_video"),
		);
	} catch (error) {
		if (isCancelled(error)) return { status: "cancelled" };
		throw error;
	}
}

export async function deleteCapturedShortVideo(
	captureId: string,
): Promise<void> {
	await invoke("media_capture_delete_short_video", { captureId });
}

function isCancelled(error: unknown): boolean {
	if (error === "cancelled") return true;
	return (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		error.message === "cancelled"
	);
}

export function reportMediaWorkflowDiagnostic(
	component: "photo_capture" | "short_video_capture",
	code: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (level === "info" && !getDeveloperSettingsSnapshot().mediaDiagnostics) {
		return;
	}
	reportClientDiagnostic({
		category: "media_workflow",
		component,
		code,
		level,
	});
}
