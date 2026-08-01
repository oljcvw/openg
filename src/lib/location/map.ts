import { type LocationPoint, locationPointSchema } from "$lib/model/location";

export function openStreetMapUrl(point: LocationPoint): string {
	const { lat, lon } = locationPointSchema.parse(point);
	const params = new URLSearchParams({ mlat: String(lat), mlon: String(lon) });
	return `https://www.openstreetmap.org/?${params.toString()}#map=16/${lat}/${lon}`;
}
