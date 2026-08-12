import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMethodMock, events, gotoMock, removeAccountCacheMock } = vi.hoisted(
	() => ({
		callMethodMock: vi.fn((method: string) => {
			events.push(method);
			return Promise.resolve();
		}),
		events: [] as string[],
		gotoMock: vi.fn(() => {
			events.push("navigate");
			return Promise.resolve();
		}),
		removeAccountCacheMock: vi.fn(() => {
			events.push("cache");
			return Promise.resolve();
		}),
	}),
);

vi.mock("$app/navigation", () => ({ goto: gotoMock }));
vi.mock("$lib/api", () => ({
	callMethod: callMethodMock,
}));
vi.mock("$lib/api/account-caches", () => ({
	invalidateAccountSession: vi.fn(() => ({ accountId: 42, generation: 1 })),
}));
vi.mock("$lib/app-data/cache-manager", () => ({
	removeAccountCache: removeAccountCacheMock,
	removeGenericAccountCache: vi.fn(),
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	clearAccountPreferences: vi.fn(() => {
		events.push("preferences");
		return Promise.resolve();
	}),
}));
vi.mock("$lib/app-data/profile-cache", () => ({
	getProfileCacheAccount: vi.fn(() => 42),
}));
vi.mock("$lib/location/profile-location", () => ({
	invalidateProfileLocationMutations: vi.fn(),
}));

import { signOut } from "$lib/api/sign-out";

describe("sign-out cleanup ordering", () => {
	beforeEach(() => {
		events.length = 0;
		vi.clearAllMocks();
	});

	it("clears account-scoped caches before native session deletion", async () => {
		await signOut();
		expect(events).toEqual([
			"notification_cancel",
			"notification_clear_account",
			"cache",
			"logout",
			"preferences",
			"navigate",
		]);
		expect(callMethodMock).toHaveBeenCalledWith("notification_clear_account", {
			accountId: 42,
		});
	});

	it("continues native logout when local cache cleanup is incomplete", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		removeAccountCacheMock.mockRejectedValueOnce(
			new Error("cache unavailable"),
		);

		await signOut();
		expect(events).toContain("logout");
		expect(events.at(-1)).toBe("navigate");
		errorSpy.mockRestore();
	});
});
