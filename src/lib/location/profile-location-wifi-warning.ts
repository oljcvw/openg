import { get } from "svelte/store";
import { writable } from "svelte/store";

import {
	profileLocationCoordinator,
	type ProfileLocationIntent,
	type ProfileLocationOutcome,
} from "$lib/location/profile-location";

export type ActionableProfileLocationIntent = Exclude<
	ProfileLocationIntent,
	{ kind: "reconcilePending" }
>;

export type ProfileLocationWifiWarningState = {
	open: boolean;
	platform: "android" | "ios";
	intent: ActionableProfileLocationIntent | null;
	settingsOpened: boolean;
	busy: boolean;
};

const initialState: ProfileLocationWifiWarningState = {
	open: false,
	platform: "ios",
	intent: null,
	settingsOpened: false,
	busy: false,
};

export const profileLocationWifiWarning = writable(initialState);

export function showProfileLocationWifiWarning(
	platform: "android" | "ios",
	intent: ActionableProfileLocationIntent | null,
): void {
	profileLocationWifiWarning.set({
		open: true,
		platform,
		intent,
		settingsOpened: false,
		busy: false,
	});
}

export function cancelProfileLocationWifiWarning(): ProfileLocationOutcome {
	profileLocationWifiWarning.set(initialState);
	return { kind: "cancelled" };
}

export async function requestProfileLocation(
	intent: ActionableProfileLocationIntent,
): Promise<ProfileLocationOutcome> {
	const outcome = await profileLocationCoordinator.request(intent);
	if (outcome.kind === "blockedByWifi") {
		showProfileLocationWifiWarning(outcome.platform, intent);
	}
	return outcome;
}

export function markWifiSettingsOpened(): void {
	profileLocationWifiWarning.update((state) => ({
		...state,
		settingsOpened: true,
	}));
}

export function setWifiWarningBusy(busy: boolean): void {
	profileLocationWifiWarning.update((state) => ({ ...state, busy }));
}

export function currentWifiWarningState(): ProfileLocationWifiWarningState {
	return get(profileLocationWifiWarning);
}

export function closeProfileLocationWifiWarning(): void {
	profileLocationWifiWarning.set(initialState);
}
