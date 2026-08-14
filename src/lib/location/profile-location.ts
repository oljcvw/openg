import { platform } from "@tauri-apps/plugin-os";

import { updateReportedProfileLocation } from "$lib/api/browse/location";
import {
	getManualLocationActiveSnapshot,
	getPendingProfileLocationSnapshot,
	getPreferences,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import {
	createReportedProfileLocation,
	type LocationPoint,
	locationPointSchema,
	type ReportedProfileLocation,
} from "$lib/model/location";
import { getDeviceLocation } from "$lib/platform/geolocation";
import {
	getFreshWifiSafetySnapshot,
	isUnsafeWifiSnapshot,
	releaseNativeLocationSafetyRecovery,
	setNativeManualLocationSafetyActive,
	type WifiSafetySnapshot,
} from "$lib/platform/wifi-location-safety";

export type ProfileLocationIntent =
	| { kind: "manual"; point: LocationPoint }
	| { kind: "device" }
	| { kind: "reconcilePending" };

export type ProfileLocationOutcome =
	| { kind: "applied" }
	| { kind: "blockedByWifi"; platform: "android" | "ios" }
	| { kind: "stagedForRestart" }
	| { kind: "cancelled" };

export class ProfileLocationSafetyInterruptedError extends Error {
	constructor() {
		super(
			"Location update was interrupted by a Wi-Fi safety-state change and will be reconciled later",
		);
		this.name = "ProfileLocationSafetyInterruptedError";
	}
}

let accountGeneration = 0;

function assertCurrentAccount(generation: number): void {
	if (generation !== accountGeneration)
		throw new Error("Location update cancelled because the account changed");
}

function blockedOutcome(): ProfileLocationOutcome {
	return {
		kind: "blockedByWifi",
		platform: platform() === "ios" ? "ios" : "android",
	};
}

function safetyChanged(
	before: WifiSafetySnapshot,
	after: WifiSafetySnapshot,
): boolean {
	return before.generation !== after.generation || isUnsafeWifiSnapshot(after);
}

async function resolveIntentLocation(
	intent: Exclude<ProfileLocationIntent, { kind: "reconcilePending" }>,
): Promise<ReportedProfileLocation> {
	if (intent.kind === "manual") {
		return createReportedProfileLocation(
			locationPointSchema.parse(intent.point),
			"manual",
		);
	}
	return createReportedProfileLocation(await getDeviceLocation(), "device");
}

async function synchronizeNativeSafetyGate(): Promise<void> {
	const pending = getPendingProfileLocationSnapshot();
	await setNativeManualLocationSafetyActive(
		getManualLocationActiveSnapshot() || pending?.source === "manual",
		pending !== null,
	);
}

async function stageLocation(
	location: ReportedProfileLocation,
	generation: number,
): Promise<ProfileLocationOutcome> {
	assertCurrentAccount(generation);
	const wifi = await getFreshWifiSafetySnapshot();
	assertCurrentAccount(generation);
	if (isUnsafeWifiSnapshot(wifi)) return blockedOutcome();
	await setPreferences({ pendingProfileLocation: location });
	await synchronizeNativeSafetyGate();
	return { kind: "stagedForRestart" };
}

async function commitLocation(
	location: ReportedProfileLocation,
	generation: number,
): Promise<ProfileLocationOutcome> {
	assertCurrentAccount(generation);
	const wifiBefore = await getFreshWifiSafetySnapshot();
	assertCurrentAccount(generation);
	if (isUnsafeWifiSnapshot(wifiBefore)) return blockedOutcome();

	await setPreferences({ pendingProfileLocation: location });
	// Any profile-location transition is sensitive until its remote outcome is
	// known, including switching an existing manual location back to device mode.
	await setNativeManualLocationSafetyActive(true, true);
	try {
		await updateReportedProfileLocation(location.geohash);
		const wifiAfter = await getFreshWifiSafetySnapshot();
		assertCurrentAccount(generation);
		if (safetyChanged(wifiBefore, wifiAfter)) {
			throw new ProfileLocationSafetyInterruptedError();
		}
	} catch (error) {
		const wifiAfter = await getFreshWifiSafetySnapshot().catch(() => null);
		const ambiguous =
			error instanceof ProfileLocationSafetyInterruptedError ||
			wifiAfter === null ||
			safetyChanged(wifiBefore, wifiAfter);
		if (!ambiguous && generation === accountGeneration) {
			await setPreferences({ pendingProfileLocation: null });
		}
		await synchronizeNativeSafetyGate();
		if (
			ambiguous &&
			!(error instanceof ProfileLocationSafetyInterruptedError)
		) {
			throw new ProfileLocationSafetyInterruptedError();
		}
		throw error;
	}

	await setPreferences({
		geohash: location.geohash,
		manualLocationActive: location.source === "manual",
		pendingProfileLocation: null,
		reportedProfileLocation: location,
	});
	await synchronizeNativeSafetyGate();
	await releaseNativeLocationSafetyRecovery();
	return { kind: "applied" };
}

export class ProfileLocationCoordinator {
	private queue: Promise<unknown> = Promise.resolve();

	private serialize<T>(task: () => Promise<T>): Promise<T> {
		const operation = this.queue.then(task, task);
		this.queue = operation.catch(() => undefined);
		return operation;
	}

	request(intent: ProfileLocationIntent): Promise<ProfileLocationOutcome> {
		const generation = accountGeneration;
		return this.serialize(async () => {
			assertCurrentAccount(generation);
			await getPreferences();
			assertCurrentAccount(generation);

			if (intent.kind === "reconcilePending") {
				const pending = getPendingProfileLocationSnapshot();
				if (pending === null) {
					await synchronizeNativeSafetyGate();
					if (getManualLocationActiveSnapshot()) {
						const wifi = await getFreshWifiSafetySnapshot();
						assertCurrentAccount(generation);
						if (isUnsafeWifiSnapshot(wifi)) return blockedOutcome();
					}
					await releaseNativeLocationSafetyRecovery();
					return { kind: "applied" };
				}
				return commitLocation(pending, generation);
			}

			return commitLocation(await resolveIntentLocation(intent), generation);
		});
	}

	stageForAndroidRestart(
		intent: Exclude<ProfileLocationIntent, { kind: "reconcilePending" }>,
	): Promise<ProfileLocationOutcome> {
		const generation = accountGeneration;
		return this.serialize(async () => {
			assertCurrentAccount(generation);
			await getPreferences();
			assertCurrentAccount(generation);
			return stageLocation(await resolveIntentLocation(intent), generation);
		});
	}

	bootstrap(): Promise<ProfileLocationOutcome> {
		return this.request({ kind: "reconcilePending" });
	}
}

export const profileLocationCoordinator = new ProfileLocationCoordinator();

export function invalidateProfileLocationMutations(): void {
	accountGeneration += 1;
}

// Browse changes do not mutate the profile location reported to Grindr. They
// remain outside this first safety slice pending separate service-risk evidence.
export async function browseThisArea(point: LocationPoint): Promise<void> {
	const location = createReportedProfileLocation(point, "manual");
	await setPreferences({ geohash: location.geohash });
}
