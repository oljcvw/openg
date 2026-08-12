import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, settings } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	settings: { logErrorsToLogcat: false },
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
	isTauri: () => true,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => settings,
}));

import { applyLogcatSetting } from "./logcat-settings";

describe("logcat setting synchronization", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(undefined);
	});

	it("synchronizes the stored default to native logging", async () => {
		settings.logErrorsToLogcat = false;

		await applyLogcatSetting();

		expect(invokeMock).toHaveBeenCalledWith("set_logcat_enabled", {
			enabled: false,
		});
	});

	it("synchronizes an explicit enabled value", async () => {
		await applyLogcatSetting(true);

		expect(invokeMock).toHaveBeenCalledWith("set_logcat_enabled", {
			enabled: true,
		});
	});
});
