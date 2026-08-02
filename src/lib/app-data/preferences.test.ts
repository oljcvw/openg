import { describe, expect, it } from "vitest";

import {
	contrastModeSchema,
	DEFAULT_DEVELOPER_SETTINGS,
	developerSettingsSchema,
	gridColumnsSchema,
	parsePreferences,
} from "$lib/app-data/preferences.svelte";

describe("preference migration", () => {
	it("adds safe defaults to an older preference payload", () => {
		const preferences = parsePreferences({
			revealMessageRead: true,
			showRetractedMessages: false,
			units: "imperial",
		});

		expect(preferences).toMatchObject({
			cacheSizeMb: 100,
			contrastMode: "standard",
			developerSettings: DEFAULT_DEVELOPER_SETTINGS,
			gridColumns: "auto",
			pendingProfileLocation: null,
			profileSwipeNavigation: true,
			reportedProfileLocation: null,
			revealMessageRead: true,
			stayAwake: false,
			units: "imperial",
		});
	});

	it("validates developer tuning boundaries", () => {
		expect(developerSettingsSchema.parse({})).toEqual({
			albumPreloadConcurrency: 3,
			apiCircuitFailurePercent: 50,
			apiCircuitMinimumSamples: 20,
			apiCircuitOpenMs: 30_000,
			apiCircuitWindowSize: 50,
			apiProtectionCooldownMs: 30_000,
			apiRequestTimeoutMs: 35_000,
			notificationPollIntervalMinutes: 15,
			placeSearchCacheEntries: 20,
			profileResolutionBatchSize: 30,
			profileResolutionWindowMs: 16,
			reconcileThrottleMs: 2_000,
		});
		expect(
			developerSettingsSchema.safeParse({ profileResolutionBatchSize: 31 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ apiRequestTimeoutMs: 4_999 }).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ notificationPollIntervalMinutes: 14 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ albumPreloadConcurrency: 9 }).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ reconcileThrottleMs: 1_999 }).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({
				apiCircuitWindowSize: 20,
				apiCircuitMinimumSamples: 21,
			}).success,
		).toBe(false);
	});

	it("keeps a legacy geohash as Browse-only state", () => {
		const preferences = parsePreferences({ geohash: "u2fkb88pbpbp" });
		expect(preferences.geohash).toBe("u2fkb88pbpbp");
		expect(preferences.reportedProfileLocation).toBeNull();
		expect(preferences.pendingProfileLocation).toBeNull();
	});

	it("preserves an explicit retracted-message opt-in", () => {
		expect(
			parsePreferences({ showRetractedMessages: true }).showRetractedMessages,
		).toBe(true);
	});

	it("removes the retired navigation-button preference", () => {
		const preferences = parsePreferences({
			profileSwipeNavigation: false,
			showProfileNavigationButtons: true,
		});

		expect(preferences.profileSwipeNavigation).toBe(false);
		expect(preferences).not.toHaveProperty("showProfileNavigationButtons");
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
