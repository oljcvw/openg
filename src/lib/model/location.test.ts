import { describe, expect, it } from "vitest";

import {
	createReportedProfileLocation,
	getLocationActivity,
	locationPointSchema,
} from "$lib/model/location";

describe("location model", () => {
	it("validates coordinate boundaries", () => {
		expect(locationPointSchema.parse({ lat: -90, lon: 180 })).toEqual({
			lat: -90,
			lon: 180,
		});
		expect(locationPointSchema.safeParse({ lat: 91, lon: 0 }).success).toBe(
			false,
		);
		expect(
			locationPointSchema.safeParse({ lat: 0, lon: Number.NaN }).success,
		).toBe(false);
	});

	it("derives distinct location activity states", () => {
		const device = createReportedProfileLocation(
			{ lat: 53.35, lon: -6.26 },
			"device",
		);
		const manual = createReportedProfileLocation(
			{ lat: 40.42, lon: -3.7 },
			"manual",
		);
		expect(
			getLocationActivity({
				browseGeohash: device.geohash,
				reportedProfileLocation: device,
				pendingProfileLocation: null,
			}),
		).toBe("device");
		expect(
			getLocationActivity({
				browseGeohash: manual.geohash,
				reportedProfileLocation: null,
				pendingProfileLocation: null,
			}),
		).toBe("browse");
		expect(
			getLocationActivity({
				browseGeohash: manual.geohash,
				reportedProfileLocation: manual,
				pendingProfileLocation: null,
			}),
		).toBe("profile");
		expect(
			getLocationActivity({
				browseGeohash: device.geohash,
				reportedProfileLocation: manual,
				pendingProfileLocation: null,
			}),
		).toBe("profile-and-browse");
	});
});
