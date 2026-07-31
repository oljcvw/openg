import { describe, expect, it } from "vitest";

import {
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
			gridColumns: "auto",
			revealMessageRead: true,
			stayAwake: false,
			units: "imperial",
		});
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
