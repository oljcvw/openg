import { describe, expect, it } from "vitest";
import { getProfiles } from "$lib/api/profile";

describe("getProfiles", () => {
	it("returns no profiles for empty input without fetching", async () => {
		await expect(getProfiles([])).resolves.toEqual([]);
	});
});
