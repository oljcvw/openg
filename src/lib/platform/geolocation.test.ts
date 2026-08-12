import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkPermissions: vi.fn(),
	getCurrentPosition: vi.fn(),
	requestPermissions: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-geolocation", () => mocks);

import {
	getDeviceLocation,
	LocationPermissionDeniedError,
} from "$lib/platform/geolocation";

describe("mobile geolocation", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses an already granted location permission", async () => {
		mocks.checkPermissions.mockResolvedValue({ location: "granted" });
		mocks.getCurrentPosition.mockResolvedValue({
			coords: { latitude: 53.35, longitude: -6.26 },
		});

		await expect(getDeviceLocation()).resolves.toEqual({
			lat: 53.35,
			lon: -6.26,
		});
		expect(mocks.requestPermissions).not.toHaveBeenCalled();
	});

	it("requests a prompted permission before locating", async () => {
		mocks.checkPermissions.mockResolvedValue({ location: "prompt" });
		mocks.requestPermissions.mockResolvedValue({ location: "granted" });
		mocks.getCurrentPosition.mockResolvedValue({
			coords: { latitude: 40.42, longitude: -3.7 },
		});

		await getDeviceLocation();

		expect(mocks.requestPermissions).toHaveBeenCalledWith(["location"]);
		expect(mocks.getCurrentPosition).toHaveBeenCalledOnce();
	});

	it("does not locate after permission denial", async () => {
		mocks.checkPermissions.mockResolvedValue({ location: "denied" });

		await expect(getDeviceLocation()).rejects.toBeInstanceOf(
			LocationPermissionDeniedError,
		);
		expect(mocks.getCurrentPosition).not.toHaveBeenCalled();
	});
});
