import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("$lib/api/users/profiles", () => ({
	getProfiles: vi.fn(),
}));

import { getProfiles } from "$lib/api/users/profiles";
import { enrichProfilesLastOnline } from "./grid";

describe("enrichProfilesLastOnline", () => {
	beforeEach(() => {
		vi.mocked(getProfiles).mockReset();
	});

	it("batches unique ids through getProfiles and maps seen", async () => {
		vi.mocked(getProfiles).mockResolvedValue([
			{ profileId: 1, seen: 1000 },
			{ profileId: 2, seen: null },
		] as never);

		const result = await enrichProfilesLastOnline([1, 1, 2]);
		expect(getProfiles).toHaveBeenCalledTimes(1);
		expect(getProfiles).toHaveBeenCalledWith([1, 2]);
		expect(result.get(1)).toBe(1000);
		expect(result.get(2)).toBeNull();
	});

	it("returns an empty map for no ids", async () => {
		await expect(enrichProfilesLastOnline([])).resolves.toEqual(new Map());
		expect(getProfiles).not.toHaveBeenCalled();
	});
});
