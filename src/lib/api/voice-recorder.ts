import {
	addPluginListener,
	invoke,
	type PluginListener,
} from "@tauri-apps/api/core";
import z from "zod";

const permissionStatusSchema = z.object({
	status: z.enum(["prompt", "granted", "denied", "blocked", "unsupported"]),
});

const readyRecordingSchema = z.object({
	status: z.literal("ready"),
	dataBase64: z.string().min(1),
	contentType: z.literal("audio/aac"),
	durationMs: z.number().int().min(1_000).max(60_000),
});

const recordingResultSchema = z.discriminatedUnion("status", [
	readyRecordingSchema,
	z.object({ status: z.literal("tooShort") }),
]);

export type VoicePermissionStatus = z.infer<
	typeof permissionStatusSchema
>["status"];
export type VoiceRecordingResult = z.infer<typeof recordingResultSchema>;
export type ReadyVoiceRecording = z.infer<typeof readyRecordingSchema>;

const PLUGIN_NAME = "open-grind-voice-recorder";
const MAX_DURATION_EVENT = "max-duration";
const RECORDING_ERROR_EVENT = "recording-error";

export async function getVoicePermissionStatus(): Promise<VoicePermissionStatus> {
	const response = await invoke("voice_recorder_permission_status");
	return permissionStatusSchema.parse(response).status;
}

export async function requestVoicePermission(): Promise<VoicePermissionStatus> {
	const response = await invoke("voice_recorder_request_permission");
	return permissionStatusSchema.parse(response).status;
}

export async function startVoiceRecording(): Promise<void> {
	await invoke("voice_recorder_start");
}

export async function stopVoiceRecording(): Promise<VoiceRecordingResult> {
	return recordingResultSchema.parse(await invoke("voice_recorder_stop"));
}

export async function cancelVoiceRecording(): Promise<void> {
	await invoke("voice_recorder_cancel");
}

export async function onVoiceRecordingMaxDuration(
	handler: (recording: ReadyVoiceRecording) => void,
): Promise<PluginListener> {
	return addPluginListener(PLUGIN_NAME, MAX_DURATION_EVENT, (payload) => {
		handler(readyRecordingSchema.parse(payload));
	});
}

export async function onVoiceRecordingError(
	handler: () => void,
): Promise<PluginListener> {
	return addPluginListener(PLUGIN_NAME, RECORDING_ERROR_EVENT, handler);
}
