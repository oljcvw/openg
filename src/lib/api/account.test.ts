import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRest } from "$lib/api";
import { getAccountPreferences, setAccountPreferences } from "$lib/api/account";

vi.mock("$lib/api", () => ({ fetchRest: vi.fn() }));

const mockedFetchRest = vi.mocked(fetchRest);

describe("account preferences API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue({
			assertOk: vi.fn(),
			jsonParsed: vi.fn((schema) =>
				schema.parse({
					profileId: 1,
					locationSearchOptOut: false,
					incognito: false,
					hideViewedMe: true,
					approximateDistance: true,
					viewRightNowNsfw: false,
					showOnMap: true,
				}),
			),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("loads the complete account privacy state", async () => {
		await expect(getAccountPreferences()).resolves.toMatchObject({
			profileId: 1,
			hideViewedMe: true,
			showOnMap: true,
		});
	});

	it("wraps updates in the API settings envelope", async () => {
		await setAccountPreferences({
			incognito: true,
			approximateDistance: false,
		});

		expect(mockedFetchRest).toHaveBeenCalledWith("/v3/me/prefs/settings", {
			method: "PUT",
			body: {
				settings: {
					incognito: true,
					approximateDistance: false,
				},
			},
		});
	});
});
