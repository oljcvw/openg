import { updateReportedProfileLocation } from "$lib/api/browse/location";
import {
	getPendingProfileLocationSnapshot,
	getPreferences,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import {
	createReportedProfileLocation,
	type LocationPoint,
	locationPointSchema,
	type LocationSource,
} from "$lib/model/location";
import { getDeviceLocation } from "$lib/platform/geolocation";

let profileLocationMutation = Promise.resolve();
let accountGeneration = 0;

function assertCurrentAccount(generation: number): void {
	if (generation !== accountGeneration)
		throw new Error("Location update cancelled because the account changed");
}

export function invalidateProfileLocationMutations(): void {
	accountGeneration += 1;
}

export async function browseThisArea(point: LocationPoint): Promise<void> {
	const location = createReportedProfileLocation(point, "manual");
	await setPreferences({ geohash: location.geohash });
}

async function commitReportedProfileLocation(
	point: LocationPoint,
	source: LocationSource,
	generation: number,
): Promise<void> {
	assertCurrentAccount(generation);
	const location = createReportedProfileLocation(point, source);
	await setPreferences({ pendingProfileLocation: location });
	assertCurrentAccount(generation);
	try {
		await updateReportedProfileLocation(location.geohash);
	} catch (error) {
		if (generation === accountGeneration)
			await setPreferences({ pendingProfileLocation: null }).catch(
				(clearError) => {
					console.error("Failed to clear pending profile location", clearError);
				},
			);
		throw error;
	}
	assertCurrentAccount(generation);
	await setPreferences({
		geohash: location.geohash,
		pendingProfileLocation: null,
		reportedProfileLocation: location,
	});
}

function runProfileLocationMutation(task: () => Promise<void>): Promise<void> {
	const mutation = profileLocationMutation.then(task, task);
	profileLocationMutation = mutation.catch(() => undefined);
	return mutation;
}

export function setProfileLocation(point: LocationPoint): Promise<void> {
	const generation = accountGeneration;
	return runProfileLocationMutation(() =>
		commitReportedProfileLocation(
			locationPointSchema.parse(point),
			"manual",
			generation,
		),
	);
}

export function useCurrentDeviceLocation(): Promise<void> {
	const generation = accountGeneration;
	return runProfileLocationMutation(async () => {
		assertCurrentAccount(generation);
		const point = await getDeviceLocation();
		await commitReportedProfileLocation(point, "device", generation);
	});
}

export function reconcilePendingProfileLocation(): Promise<void> {
	const generation = accountGeneration;
	return runProfileLocationMutation(async () => {
		assertCurrentAccount(generation);
		await getPreferences();
		assertCurrentAccount(generation);
		const pending = getPendingProfileLocationSnapshot();
		if (pending === null) return;
		await updateReportedProfileLocation(pending.geohash);
		assertCurrentAccount(generation);
		await setPreferences({
			geohash: pending.geohash,
			pendingProfileLocation: null,
			reportedProfileLocation: pending,
		});
	});
}
