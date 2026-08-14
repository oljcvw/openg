import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	invoke: vi.fn(),
	platform: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: mocks.platform }));

import {
	getFreshWifiSafetySnapshot,
	isUnsafeWifiSnapshot,
	listenForWifiSafetyChanges,
} from "$lib/platform/wifi-location-safety";

describe("Wi-Fi location safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.platform.mockReturnValue("android");
	});

	it("reads the authoritative native snapshot on Android and iOS", async () => {
		mocks.invoke.mockResolvedValue({
			known: true,
			connected: true,
			generation: 7,
		});

		await expect(getFreshWifiSafetySnapshot()).resolves.toEqual({
			known: true,
			connected: true,
			generation: 7,
		});
		expect(mocks.invoke).toHaveBeenCalledWith("wifi_connection_status");
	});

	it("treats unknown and connected snapshots as unsafe", () => {
		expect(
			isUnsafeWifiSnapshot({ known: false, connected: false, generation: 0 }),
		).toBe(true);
		expect(
			isUnsafeWifiSnapshot({ known: true, connected: true, generation: 1 }),
		).toBe(true);
		expect(
			isUnsafeWifiSnapshot({ known: true, connected: false, generation: 2 }),
		).toBe(false);
	});

	it("uses a known non-Wi-Fi snapshot on desktop", async () => {
		mocks.platform.mockReturnValue("macos");

		await expect(getFreshWifiSafetySnapshot()).resolves.toEqual({
			known: true,
			connected: false,
			generation: 0,
		});
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("delivers semantic native change events", async () => {
		let callback: ((event: { payload: unknown }) => void) | undefined;
		const unregister = vi.fn();
		mocks.listen.mockImplementation(
			(_event, listener: (event: { payload: unknown }) => void) => {
				callback = listener;
				return Promise.resolve(unregister);
			},
		);
		const listener = vi.fn();
		const release = await listenForWifiSafetyChanges(listener);

		callback?.({
			payload: { known: true, connected: true, generation: 4 },
		});
		expect(listener).toHaveBeenCalledWith({
			known: true,
			connected: true,
			generation: 4,
		});
		release();
		expect(unregister).toHaveBeenCalledOnce();
	});
});
