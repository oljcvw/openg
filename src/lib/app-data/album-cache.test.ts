import { describe, expect, it } from "vitest";

import { classifyDiscoveryAccess } from "$lib/app-data/album-cache";

describe("album access classification", () => {
	it("keeps a currently viewable album active", () => {
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, isViewable: true },
				1_000,
			),
		).toBeNull();
	});

	it("distinguishes expiry from exhausted views", () => {
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, expiresAt: 999 },
				1_000,
			),
		).toMatchObject({ status: "unavailable", reason: "expired" });
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, isViewable: false },
				1_000,
			),
		).toMatchObject({ status: "unavailable", reason: "views_exhausted" });
	});
});
