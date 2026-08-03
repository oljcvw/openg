// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgeFilterSlider from "./AgeFilterSlider.svelte";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("AgeFilterSlider", () => {
	it("uses configured bounds without changing the slider control", () => {
		const view = render(AgeFilterSlider, {
			props: { value: [25, 55], min: 25, max: 55 },
		});

		for (const thumb of view.getAllByRole("slider")) {
			expect(thumb.getAttribute("aria-valuemin")).toBe("25");
			expect(thumb.getAttribute("aria-valuemax")).toBe("55");
		}
		expect(view.getByRole("slider", { name: "Minimum age" })).toBeTruthy();
		expect(view.getByRole("slider", { name: "Maximum age" })).toBeTruthy();
	});

	it("retains the full protocol range by default", () => {
		const view = render(AgeFilterSlider, { props: { value: [18, 102] } });

		for (const thumb of view.getAllByRole("slider")) {
			expect(thumb.getAttribute("aria-valuemin")).toBe("18");
			expect(thumb.getAttribute("aria-valuemax")).toBe("102");
		}
		expect(
			view
				.getByRole("slider", { name: "Maximum age" })
				.getAttribute("aria-valuetext"),
		).toBe("And over");
	});
});
