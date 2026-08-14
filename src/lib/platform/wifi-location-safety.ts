import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import z from "zod";

export const wifiSafetySnapshotSchema = z.object({
	known: z.boolean(),
	connected: z.boolean(),
	generation: z.number().int().nonnegative(),
});
export type WifiSafetySnapshot = z.infer<typeof wifiSafetySnapshotSchema>;

const desktopSnapshot: WifiSafetySnapshot = {
	known: true,
	connected: false,
	generation: 0,
};

let latestSnapshot: WifiSafetySnapshot | null = null;

export async function getFreshWifiSafetySnapshot(): Promise<WifiSafetySnapshot> {
	if (!(["android", "ios"] as string[]).includes(platform())) {
		latestSnapshot = desktopSnapshot;
		return desktopSnapshot;
	}
	const snapshot = wifiSafetySnapshotSchema.parse(
		await invoke("wifi_connection_status"),
	);
	latestSnapshot = snapshot;
	return snapshot;
}

export function getWifiSafetySnapshot(): WifiSafetySnapshot | null {
	return latestSnapshot;
}

export async function setNativeManualLocationSafetyActive(
	active: boolean,
	recoveryPending: boolean,
): Promise<void> {
	await invoke("location_wifi_safety_set_active", { active, recoveryPending });
	const currentPlatform = platform();
	if (currentPlatform === "android") {
		window.__AndroidWifi?.setManualLocationActive(active);
	} else if (currentPlatform === "ios") {
		await invoke("plugin:open-grind-realtime-network|setManualLocationActive", {
			active,
		});
	}
}

export async function releaseNativeLocationSafetyRecovery(): Promise<void> {
	await invoke("location_wifi_safety_release_recovery");
}

export async function listenForWifiSafetyChanges(
	listener: (snapshot: WifiSafetySnapshot) => void,
): Promise<() => void> {
	const unregister = await listen("wifi-state-changed", (event) => {
		const snapshot = wifiSafetySnapshotSchema.parse(event.payload);
		latestSnapshot = snapshot;
		listener(snapshot);
	});
	return () => unregister();
}

export function isUnsafeWifiSnapshot(snapshot: WifiSafetySnapshot): boolean {
	return !snapshot.known || snapshot.connected;
}
