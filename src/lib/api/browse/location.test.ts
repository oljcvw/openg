import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock } = vi.hoisted(() => ({ fetchRestMock: vi.fn() }));

vi.mock("$lib/api", () => ({ fetchRest: fetchRestMock }));

import { updateReportedProfileLocation } from "$lib/api/browse/location";

describe("profile location API", () => {
	beforeEach(() => fetchRestMock.mockReset());

	it("updates the authenticated profile with a geohash", async () => {
		const assertOk = vi.fn();
		fetchRestMock.mockResolvedValue({ assertOk });

		await updateReportedProfileLocation("u2fkb88pbpbp");

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/location", {
			method: "PUT",
			body: { geohash: "u2fkb88pbpbp" },
		});
		expect(assertOk).toHaveBeenCalledOnce();
	});
});
