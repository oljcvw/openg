import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getDeviceLocation: vi.fn(),
	getManualLocationActiveSnapshot: vi.fn(),
	getPendingProfileLocationSnapshot: vi.fn(),
	getPreferences: vi.fn(),
	getFreshWifiSafetySnapshot: vi.fn(),
	releaseNativeLocationSafetyRecovery: vi.fn(),
	setNativeManualLocationSafetyActive: vi.fn(),
	setPreferences: vi.fn(),
	updateReportedProfileLocation: vi.fn(),
}));

vi.mock("$lib/api/browse/location", () => ({
	updateReportedProfileLocation: mocks.updateReportedProfileLocation,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getManualLocationActiveSnapshot: mocks.getManualLocationActiveSnapshot,
	getPendingProfileLocationSnapshot: mocks.getPendingProfileLocationSnapshot,
	getPreferences: mocks.getPreferences,
	setPreferences: mocks.setPreferences,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "android" }));
vi.mock("$lib/platform/wifi-location-safety", () => ({
	getFreshWifiSafetySnapshot: mocks.getFreshWifiSafetySnapshot,
	isUnsafeWifiSnapshot: (snapshot: { known: boolean; connected: boolean }) =>
		!snapshot.known || snapshot.connected,
	releaseNativeLocationSafetyRecovery:
		mocks.releaseNativeLocationSafetyRecovery,
	setNativeManualLocationSafetyActive:
		mocks.setNativeManualLocationSafetyActive,
}));
vi.mock("$lib/platform/geolocation", () => ({
	getDeviceLocation: mocks.getDeviceLocation,
}));

import {
	browseThisArea,
	invalidateProfileLocationMutations,
	profileLocationCoordinator,
} from "$lib/location/profile-location";
import { createReportedProfileLocation } from "$lib/model/location";

describe("profile location transactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getPreferences.mockResolvedValue({});
		mocks.getManualLocationActiveSnapshot.mockReturnValue(false);
		mocks.getPendingProfileLocationSnapshot.mockReturnValue(null);
		mocks.getFreshWifiSafetySnapshot.mockResolvedValue({
			known: true,
			connected: false,
			generation: 1,
		});
		mocks.setNativeManualLocationSafetyActive.mockResolvedValue(undefined);
		mocks.releaseNativeLocationSafetyRecovery.mockResolvedValue(undefined);
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

		await profileLocationCoordinator.request({ kind: "manual", point });

		expect(mocks.setPreferences).toHaveBeenNthCalledWith(1, {
			pendingProfileLocation: location,
		});
		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledWith(
			location.geohash,
		);
		expect(mocks.setPreferences).toHaveBeenNthCalledWith(2, {
			geohash: location.geohash,
			manualLocationActive: true,
			pendingProfileLocation: null,
			reportedProfileLocation: location,
		});
		const pendingOrder = mocks.setPreferences.mock.invocationCallOrder[0]!;
		const remoteOrder =
			mocks.updateReportedProfileLocation.mock.invocationCallOrder[0]!;
		expect(pendingOrder).toBeLessThan(remoteOrder);
	});

	it("preserves confirmed state when remote update fails", async () => {
		mocks.updateReportedProfileLocation.mockRejectedValueOnce(
			new Error("offline"),
		);

		await expect(
			profileLocationCoordinator.request({
				kind: "manual",
				point: { lat: 40.42, lon: -3.7 },
			}),
		).rejects.toThrow("offline");
		expect(mocks.setPreferences).toHaveBeenLastCalledWith({
			pendingProfileLocation: null,
		});
		expect(mocks.setPreferences).not.toHaveBeenCalledWith(
			expect.objectContaining({ reportedProfileLocation: expect.anything() }),
		);
	});

	it.each([
		{ known: true, connected: true, generation: 2 },
		{ known: false, connected: false, generation: 0 },
	])(
		"makes zero writes and remote calls for unsafe snapshot $known/$connected",
		async (snapshot) => {
			mocks.getFreshWifiSafetySnapshot.mockResolvedValue(snapshot);

			await expect(
				profileLocationCoordinator.request({
					kind: "manual",
					point: { lat: 40.42, lon: -3.7 },
				}),
			).resolves.toEqual({ kind: "blockedByWifi", platform: "android" });
			expect(mocks.setPreferences).not.toHaveBeenCalled();
			expect(mocks.updateReportedProfileLocation).not.toHaveBeenCalled();
		},
	);

	it("retains pending intent if Wi-Fi generation changes during remote mutation", async () => {
		mocks.getFreshWifiSafetySnapshot
			.mockResolvedValueOnce({ known: true, connected: false, generation: 3 })
			.mockResolvedValue({ known: true, connected: false, generation: 4 });

		await expect(
			profileLocationCoordinator.request({
				kind: "manual",
				point: { lat: 40.42, lon: -3.7 },
			}),
		).rejects.toThrow("interrupted by a Wi-Fi safety-state change");
		expect(mocks.setPreferences).toHaveBeenCalledTimes(1);
		expect(mocks.setPreferences).toHaveBeenCalledWith({
			pendingProfileLocation: expect.objectContaining({ source: "manual" }),
		});
	});

	it("blocks protected bootstrap when confirmed manual location meets Wi-Fi", async () => {
		mocks.getManualLocationActiveSnapshot.mockReturnValue(true);
		mocks.getFreshWifiSafetySnapshot.mockResolvedValue({
			known: true,
			connected: true,
			generation: 9,
		});

		await expect(profileLocationCoordinator.bootstrap()).resolves.toEqual({
			kind: "blockedByWifi",
			platform: "android",
		});
		expect(mocks.setNativeManualLocationSafetyActive).toHaveBeenCalledWith(
			true,
			false,
		);
		expect(mocks.updateReportedProfileLocation).not.toHaveBeenCalled();
		expect(mocks.setPreferences).not.toHaveBeenCalled();
	});

	it("reports a fresh device position as device-sourced", async () => {
		mocks.getDeviceLocation.mockResolvedValue({ lat: 53.35, lon: -6.26 });

		await profileLocationCoordinator.request({ kind: "device" });

		expect(mocks.getDeviceLocation).toHaveBeenCalledOnce();
		expect(mocks.setPreferences).toHaveBeenLastCalledWith(
			expect.objectContaining({
				reportedProfileLocation: expect.objectContaining({ source: "device" }),
			}),
		);
	});

	it("stages a manual location for restart without reporting it", async () => {
		const point = { lat: 40.42, lon: -3.7 };
		const location = createReportedProfileLocation(point, "manual");

		await profileLocationCoordinator.stageForAndroidRestart({
			kind: "manual",
			point,
		});

		expect(mocks.setPreferences).toHaveBeenCalledWith({
			pendingProfileLocation: location,
		});
		expect(mocks.updateReportedProfileLocation).not.toHaveBeenCalled();
	});

	it("stages device location for restart without reporting it", async () => {
		mocks.getDeviceLocation.mockResolvedValue({ lat: 53.35, lon: -6.26 });

		await profileLocationCoordinator.stageForAndroidRestart({ kind: "device" });

		expect(mocks.setPreferences).toHaveBeenCalledWith({
			pendingProfileLocation: expect.objectContaining({ source: "device" }),
		});
		expect(mocks.updateReportedProfileLocation).not.toHaveBeenCalled();
	});

	it("hydrates and retries a durable pending update", async () => {
		const pending = createReportedProfileLocation(
			{ lat: 40.42, lon: -3.7 },
			"manual",
		);
		mocks.getPendingProfileLocationSnapshot.mockReturnValue(pending);

		await profileLocationCoordinator.request({ kind: "reconcilePending" });

		expect(mocks.getPreferences).toHaveBeenCalledOnce();
		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledWith(
			pending.geohash,
		);
		expect(mocks.setPreferences).toHaveBeenLastCalledWith({
			geohash: pending.geohash,
			manualLocationActive: true,
			pendingProfileLocation: null,
			reportedProfileLocation: pending,
		});
	});

	it("serializes distinct profile location changes", async () => {
		let releaseFirstUpdate = () => {};
		mocks.updateReportedProfileLocation.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseFirstUpdate = resolve)),
		);

		const first = profileLocationCoordinator.request({
			kind: "manual",
			point: { lat: 40.42, lon: -3.7 },
		});
		const second = profileLocationCoordinator.request({
			kind: "manual",
			point: { lat: 53.35, lon: -6.26 },
		});
		await vi.waitFor(() =>
			expect(mocks.updateReportedProfileLocation).toHaveBeenCalledTimes(1),
		);
		releaseFirstUpdate();
		await Promise.all([first, second]);

		expect(mocks.updateReportedProfileLocation).toHaveBeenCalledTimes(2);
		expect(mocks.updateReportedProfileLocation.mock.calls[0]!).not.toEqual(
			mocks.updateReportedProfileLocation.mock.calls[1]!,
		);
	});

	it("does not promote an update after account state is invalidated", async () => {
		let releaseUpdate = () => {};
		mocks.updateReportedProfileLocation.mockImplementationOnce(
			() => new Promise<void>((resolve) => (releaseUpdate = resolve)),
		);

		const update = profileLocationCoordinator.request({
			kind: "manual",
			point: { lat: 40.42, lon: -3.7 },
		});
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
