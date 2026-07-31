import { describe, expect, it } from "vitest";

import {
	contrastModeSchema,
	gridColumnsSchema,
	parsePreferences,
} from "$lib/app-data/preferences.svelte";

describe("preference migration", () => {
	it("adds safe defaults to an older preference payload", () => {
		const preferences = parsePreferences({
			revealMessageRead: true,
			units: "imperial",
		});

		expect(preferences).toMatchObject({
			contrastMode: "standard",
			gridColumns: "auto",
			revealMessageRead: true,
			showProfileNavigationButtons: false,
			stayAwake: false,
			units: "imperial",
		});
	});

	it("accepts standard and high contrast modes", () => {
		expect(contrastModeSchema.parse("standard")).toBe("standard");
		expect(contrastModeSchema.parse("high")).toBe("high");
		expect(contrastModeSchema.safeParse("system").success).toBe(false);
	});

	it("accepts Auto or two through seven Browse columns", () => {
		expect(gridColumnsSchema.parse("auto")).toBe("auto");
		for (const columns of [2, 3, 4, 5, 6, 7]) {
			expect(gridColumnsSchema.parse(columns)).toBe(columns);
		}
		expect(gridColumnsSchema.safeParse(1).success).toBe(false);
		expect(gridColumnsSchema.safeParse(8).success).toBe(false);
	});
});
