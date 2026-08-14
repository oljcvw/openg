import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	bootstrap: vi.fn(),
	stageForAndroidRestart: vi.fn(),
}));

vi.mock("$lib/location/profile-location", () => ({
	profileLocationCoordinator: {
		bootstrap: mocks.bootstrap,
		stageForAndroidRestart: mocks.stageForAndroidRestart,
	},
}));

import { continueAfterAndroidWifiDisabled } from "$lib/location/profile-location-wifi-warning";

describe("Android Wi-Fi warning recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reconciles bootstrap safety when warning has no pending intent", async () => {
		mocks.bootstrap.mockResolvedValue({ kind: "applied" });

		await expect(continueAfterAndroidWifiDisabled(null)).resolves.toEqual({
			kind: "applied",
		});
		expect(mocks.bootstrap).toHaveBeenCalledOnce();
		expect(mocks.stageForAndroidRestart).not.toHaveBeenCalled();
	});

	it("stages an actionable location before Android restart", async () => {
		const intent = { kind: "device" } as const;
		mocks.stageForAndroidRestart.mockResolvedValue({
			kind: "stagedForRestart",
		});

		await expect(continueAfterAndroidWifiDisabled(intent)).resolves.toEqual({
			kind: "stagedForRestart",
		});
		expect(mocks.stageForAndroidRestart).toHaveBeenCalledWith(intent);
		expect(mocks.bootstrap).not.toHaveBeenCalled();
	});
});
