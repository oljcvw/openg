import {
	checkPermissions,
	getCurrentPosition,
	requestPermissions,
} from "@tauri-apps/plugin-geolocation";

import { type LocationPoint, locationPointSchema } from "$lib/model/location";

export class LocationPermissionDeniedError extends Error {
	constructor() {
		super("Location permission denied");
		this.name = "LocationPermissionDeniedError";
	}
}

export async function getDeviceLocation(): Promise<LocationPoint> {
	let permissions = await checkPermissions();
	if (
		permissions.location === "prompt" ||
		permissions.location === "prompt-with-rationale"
	) {
		permissions = await requestPermissions(["location"]);
	}
	if (permissions.location !== "granted") {
		throw new LocationPermissionDeniedError();
	}
	const position = await getCurrentPosition();
	return locationPointSchema.parse({
		lat: position.coords.latitude,
		lon: position.coords.longitude,
	});
}
