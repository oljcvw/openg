import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getDeviceLocation: vi.fn(),
	getPendingProfileLocationSnapshot: vi.fn(),
	getPreferences: vi.fn(),
	setPreferences: vi.fn(),
	updateReportedProfileLocation: vi.fn(),
}));

vi.mock("$lib/api/browse/location", () => ({
	updateReportedProfileLocation: mocks.updateReportedProfileLocation,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getPendingProfileLocationSnapshot: mocks.getPendingProfileLocationSnapshot,
	getPreferences: mocks.getPreferences,
	setPreferences: mocks.setPreferences,
}));
vi.mock("$lib/platform/geolocation", () => ({
	getDeviceLocation: mocks.getDeviceLocation,
}));

import {
	browseThisArea,
	invalidateProfileLocationMutations,
	reconcilePendingProfileLocation,
	setProfileLocation,
	useCurrentDeviceLocation,
} from "$lib/location/profile-location";
import { createReportedProfileLocation } from "$lib/model/location";

describe("profile location transactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getPreferences.mockResolvedValue({});
		mocks.setPreferences.mockResolvedValue(undefined);
		mocks.updateReportedProfileLocation.mockResolvedValue(undefined);
	});

	it("changes Browse without updating profile location", async () => {
		await browseThisArea({ lat: 53.35, lon: -6.26 });
		expect(mocks.setPreferences).toHaveBeenCalledOnce();
		expect(mocks.setPreferences).toHaveBeenCalledWith({
			geohash: expect.any(String),
		});
		expect(mocks.updateReportedProfileLocation).not.toHaveBeenCalled();
	});

	it("persists pending intent before reporting and promoting", async () => {
		const point = { lat: 40.42, lon: -3.7 };
		const location = createReportedProfileLocation(point, "manual");

		await setProfileLocation(point);

		expect(mocks.setPreferences).toHaveBeenNthCalledWith(1, {
			pendingProfileLocation: location,
		});
		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledWith(
			location.geohash,
		);
		expect(mocks.setPreferences).toHaveBeenNthCalledWith(2, {
			geohash: location.geohash,
			pendingProfileLocation: null,
			reportedProfileLocation: location,
		});
		const pendingOrder = mocks.setPreferences.mock.invocationCallOrder[0];
		const remoteOrder =
			mocks.updateReportedProfileLocation.mock.invocationCallOrder[0];
		expect(pendingOrder).toBeLessThan(remoteOrder);
	});

	it("preserves confirmed state when remote update fails", async () => {
		mocks.updateReportedProfileLocation.mockRejectedValueOnce(
			new Error("offline"),
		);

		await expect(setProfileLocation({ lat: 40.42, lon: -3.7 })).rejects.toThrow(
			"offline",
		);
		expect(mocks.setPreferences).toHaveBeenLastCalledWith({
			pendingProfileLocation: null,
		});
		expect(mocks.setPreferences).not.toHaveBeenCalledWith(
			expect.objectContaining({ reportedProfileLocation: expect.anything() }),
		);
	});

	it("reports a fresh device position as device-sourced", async () => {
		mocks.getDeviceLocation.mockResolvedValue({ lat: 53.35, lon: -6.26 });

		await useCurrentDeviceLocation();

		expect(mocks.getDeviceLocation).toHaveBeenCalledOnce();
		expect(mocks.setPreferences).toHaveBeenLastCalledWith(
			expect.objectContaining({
				reportedProfileLocation: expect.objectContaining({ source: "device" }),
			}),
		);
	});

	it("hydrates and retries a durable pending update", async () => {
		const pending = createReportedProfileLocation(
			{ lat: 40.42, lon: -3.7 },
			"manual",
		);
		mocks.getPendingProfileLocationSnapshot.mockReturnValue(pending);

		await reconcilePendingProfileLocation();

		expect(mocks.getPreferences).toHaveBeenCalledOnce();
		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledWith(
			pending.geohash,
		);
		expect(mocks.setPreferences).toHaveBeenLastCalledWith({
			geohash: pending.geohash,
			pendingProfileLocation: null,
			reportedProfileLocation: pending,
		});
	});

	it("serializes distinct profile location changes", async () => {
		let releaseFirstUpdate = () => {};
		mocks.updateReportedProfileLocation.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseFirstUpdate = resolve)),
		);

		const first = setProfileLocation({ lat: 40.42, lon: -3.7 });
		const second = setProfileLocation({ lat: 53.35, lon: -6.26 });
		await vi.waitFor(() =>
			expect(mocks.updateReportedProfileLocation).toHaveBeenCalledTimes(1),
		);
		releaseFirstUpdate();
		await Promise.all([first, second]);

		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledTimes(2);
		expect(mocks.updateReportedProfileLocation.mock.calls[0]).not.toEqual(
			mocks.updateReportedProfileLocation.mock.calls[1],
		);
	});

	it("does not promote an update after account state is invalidated", async () => {
		let releaseUpdate = () => {};
		mocks.updateReportedProfileLocation.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseUpdate = resolve)),
		);

		const update = setProfileLocation({ lat: 40.42, lon: -3.7 });
		await vi.waitFor(() =>
			expect(mocks.updateReportedProfileLocation).toHaveBeenCalledOnce(),
		);
		invalidateProfileLocationMutations();
		releaseUpdate();

		await expect(update).rejects.toThrow("account changed");
		expect(mocks.setPreferences).not.toHaveBeenCalledWith(
			expect.objectContaining({ reportedProfileLocation: expect.anything() }),
		);
	});
});
