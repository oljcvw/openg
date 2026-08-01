import z from "zod";

import { encodeGeohash, geohashSchema } from "$lib/model/geohash";

export const locationPointSchema = z.object({
	lat: z.number().finite().min(-90).max(90),
	lon: z.number().finite().min(-180).max(180),
});

export type LocationPoint = z.infer<typeof locationPointSchema>;

export const locationSourceSchema = z.enum(["device", "manual"]);
export type LocationSource = z.infer<typeof locationSourceSchema>;

export const reportedProfileLocationSchema = locationPointSchema
	.extend({
		geohash: geohashSchema,
		source: locationSourceSchema,
	})
	.refine(
		(location) =>
			encodeGeohash(location.lat, location.lon) === location.geohash,
		{ message: "Location coordinates do not match geohash" },
	);

export type ReportedProfileLocation = z.infer<
	typeof reportedProfileLocationSchema
>;

export function createReportedProfileLocation(
	point: LocationPoint,
	source: LocationSource,
): ReportedProfileLocation {
	const parsed = locationPointSchema.parse(point);
	return reportedProfileLocationSchema.parse({
		...parsed,
		geohash: encodeGeohash(parsed.lat, parsed.lon),
		source,
	});
}

export type LocationActivity =
	| "device"
	| "browse"
	| "profile"
	| "profile-and-browse"
	| "pending";

export function getLocationActivity({
	browseGeohash,
	reportedProfileLocation,
	pendingProfileLocation,
}: {
	browseGeohash: string | null;
	reportedProfileLocation: ReportedProfileLocation | null;
	pendingProfileLocation: ReportedProfileLocation | null;
}): LocationActivity {
	if (pendingProfileLocation !== null) return "pending";
	if (reportedProfileLocation === null) return "browse";
	const browsingElsewhere = browseGeohash !== reportedProfileLocation.geohash;
	if (reportedProfileLocation.source === "manual") {
		return browsingElsewhere ? "profile-and-browse" : "profile";
	}
	return browsingElsewhere ? "browse" : "device";
}
