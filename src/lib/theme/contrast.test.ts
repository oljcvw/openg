// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { applyContrastMode } from "./contrast";

describe("contrast mode", () => {
	afterEach(() => {
		delete document.documentElement.dataset.contrast;
	});

	it("marks the app root when high contrast is selected", () => {
		applyContrastMode("high");

		expect(document.documentElement.dataset.contrast).toBe("high");
	});

	it("restores the standard semantic theme", () => {
		document.documentElement.dataset.contrast = "high";

		applyContrastMode("standard");

		expect(document.documentElement.dataset.contrast).toBeUndefined();
	});
});
