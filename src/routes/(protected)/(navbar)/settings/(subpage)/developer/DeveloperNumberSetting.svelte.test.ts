// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({
		navigationTransitionTimeoutMs: 8_000,
	}),
	setDeveloperSettings: vi.fn(() => Promise.resolve()),
}));

import DeveloperNumberSetting from "./DeveloperNumberSetting.svelte";

afterEach(cleanup);

describe("DeveloperNumberSetting", () => {
	it("names and describes the number input with its setting content", () => {
		const description =
			"How long navigation may wait before preserving the current screen.";
		const view = render(DeveloperNumberSetting, {
			description,
			max: 30_000,
			min: 2_000,
			setting: "navigationTransitionTimeoutMs",
			title: "Navigation transition timeout",
			unit: "milliseconds",
		});

		expect(
			view.getByRole("spinbutton", {
				name: "Navigation transition timeout",
				description,
			}),
		).toBeTruthy();
	});
});
