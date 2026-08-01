import { describe, expect, it } from "vitest";

import { openStreetMapUrl } from "$lib/location/map";

describe("OpenStreetMap links", () => {
	it("builds an HTTPS map URL for bounded coordinates", () => {
		const url = new URL(openStreetMapUrl({ lat: 53.35, lon: -6.26 }));
		expect(url.origin).toBe("https://www.openstreetmap.org");
		expect(url.searchParams.get("mlat")).toBe("53.35");
		expect(url.searchParams.get("mlon")).toBe("-6.26");
	});
});
