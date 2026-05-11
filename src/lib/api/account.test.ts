import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAccountPreferences,
	getHomeLocation,
	getVisitingSettings,
	setAccountPreferences,
	setHomeLocation,
	setVisitingSettings,
	updateEmail,
	updatePassword,
	validatePasswordComplexity,
} from "$lib/api/account";
import { fetchRest } from "$lib/api";

vi.mock("$lib/api", () => ({
	fetchRest: vi.fn(),
}));

const mockedFetchRest = vi.mocked(fetchRest);

describe("account preferences API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) =>
				schema.parse({
					profileId: 1,
					locationSearchOptOut: false,
					incognito: false,
					hideViewedMe: true,
					approximateDistance: true,
					viewRightNowNsfw: false,
				}),
			),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("loads account privacy preferences", async () => {
		const preferences = await getAccountPreferences();

		expect(mockedFetchRest).toHaveBeenCalledWith("/v3/me/prefs/settings", {
			method: "GET",
		});
		expect(preferences.hideViewedMe).toBe(true);
	});

	it("updates mutable account privacy preferences", async () => {
		await setAccountPreferences({
			incognito: true,
			approximateDistance: false,
		});

		expect(mockedFetchRest).toHaveBeenCalledWith("/v3/me/prefs/settings", {
			method: "PUT",
			body: {
				incognito: true,
				approximateDistance: false,
			},
		});
	});
});

describe("visiting settings API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) => schema.parse({ setting: "AUTO" })),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("loads and updates visiting mode", async () => {
		await expect(getVisitingSettings()).resolves.toEqual({ setting: "AUTO" });
		await setVisitingSettings("OFF");

		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			1,
			"/v1/visiting/settings",
			{ method: "GET" },
		);
		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			2,
			"/v1/visiting/settings",
			{ method: "PUT", body: { setting: "OFF" } },
		);
	});

	it("loads and updates home location", async () => {
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) =>
				schema.parse({ name: "Berlin", lat: 52.52, lon: 13.405 }),
			),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);

		await expect(getHomeLocation()).resolves.toEqual({
			name: "Berlin",
			lat: 52.52,
			lon: 13.405,
		});
		await setHomeLocation({ lat: 48.8566, lon: 2.3522 });

		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v1/visiting/home", {
			method: "PUT",
			body: { lat: 48.8566, lon: 2.3522 },
		});
	});
});

describe("account credential API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) => schema.parse({ valid: true })),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("validates password complexity", async () => {
		await validatePasswordComplexity("correct horse battery staple");

		expect(mockedFetchRest).toHaveBeenCalledWith("/v3/users/password-validation", {
			method: "POST",
			body: { password: "correct horse battery staple" },
		});
	});

	it("updates password and email through account endpoints", async () => {
		await updatePassword({
			currentPassword: "old-password",
			newPassword: "new-password",
		});
		await updateEmail({ email: "new@example.com", password: "password" });

		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			1,
			"/v3/users/update-password",
			{
				method: "POST",
				body: {
					currentPassword: "old-password",
					newPassword: "new-password",
				},
			},
		);
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v3/users/email", {
			method: "POST",
			body: { email: "new@example.com", password: "password" },
		});
	});
});
