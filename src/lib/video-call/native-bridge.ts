import { addPluginListener, invoke } from "@tauri-apps/api/core";
import z from "zod";

import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";

const VIDEO_CALL_PLUGIN = "open-grind-video-call";

export type NativeVideoCallDirection = "incoming" | "outgoing";

export type NativeVideoCallSession = {
	channelId: string;
	token: string;
	direction: NativeVideoCallDirection;
	connectedLimitSeconds: number;
};

export interface VideoCallNativeBridge {
	isAvailable(): Promise<boolean>;
	start(session: NativeVideoCallSession): Promise<void>;
	renewToken(token: string): Promise<void>;
	stop(): Promise<void>;
	onRemoteParticipantJoined(handler: () => void): Promise<() => void>;
	onEnded(handler: () => void): Promise<() => void>;
}

const availabilitySchema = z.object({ available: z.boolean() });

export const nativeVideoCallBridge: VideoCallNativeBridge = {
	async isAvailable() {
		try {
			const result = await invoke("video_call_availability");
			return availabilitySchema.parse(result).available;
		} catch {
			return false;
		}
	},
	async start(session) {
		await invoke("video_call_start", {
			session: {
				...session,
				quality: getDeveloperSettingsSnapshot().videoCallQualityPreset,
			},
		});
	},
	async renewToken(token) {
		await invoke("video_call_renew_token", { token });
	},
	async stop() {
		await invoke("video_call_stop");
	},
	async onRemoteParticipantJoined(handler) {
		try {
			const listener = await addPluginListener(
				VIDEO_CALL_PLUGIN,
				"remote-user-joined",
				() => handler(),
			);
			return () => void listener.unregister();
		} catch {
			return () => undefined;
		}
	},
	async onEnded(handler) {
		try {
			const listener = await addPluginListener(VIDEO_CALL_PLUGIN, "ended", () =>
				handler(),
			);
			return () => void listener.unregister();
		} catch {
			return () => undefined;
		}
	},
};
