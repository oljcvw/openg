import { describe, expect, it } from "vitest";

import {
	contrastModeSchema,
	DEFAULT_DEVELOPER_SETTINGS,
	developerSettingsSchema,
	gridColumnsSchema,
	parsePreferences,
	videoCallQualityPresetSchema,
} from "$lib/app-data/preferences.svelte";

describe("preference migration", () => {
	it("adds safe defaults to an older preference payload", () => {
		const preferences = parsePreferences({
			revealMessageRead: true,
			showRetractedMessages: false,
			units: "imperial",
		});

		expect(preferences).toMatchObject({
			storageVersion: 2,
			cacheSizeMb: 100,
			contrastMode: "standard",
			developerSettings: DEFAULT_DEVELOPER_SETTINGS,
			gridColumns: "auto",
			keepBottomNavigationBehindKeyboard: true,
			keepUnavailableCachedAlbums: true,
			pendingProfileLocation: null,
			profileSwipeNavigation: true,
			retainSharedChatMedia: true,
			reportedProfileLocation: null,
			revealMessageRead: true,
			stayAwake: false,
			units: "imperial",
		});
	});

	it("validates developer tuning boundaries", () => {
		expect(developerSettingsSchema.parse({})).toEqual({
			albumCacheCdnRetryLimit: 2,
			albumCacheMediaConcurrency: 2,
			albumCacheRequestIntervalMs: 2_000,
			albumCacheValidationMinutes: 60,
			albumPreloadConcurrency: 3,
			albumPreloadTimeoutMs: 30_000,
			conversationSearchDebounceMs: 250,
			browseAgeScaleMax: 102,
			browseAgeScaleMin: 18,
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
			directMediaCacheConcurrency: 2,
			directMediaCacheMb: 30,
			legacyShortVideoFetchMaxMb: 30,
			legacyShortVideoFetchTimeoutMs: 30_000,
			messageDuplicateReconcileWindowMs: 5_000,
			sharedAlbumRefreshSeconds: 150,
			shortVideoLooping: false,
			videoCallQualityPreset: "auto",
			mediaDiagnostics: false,
			logErrorsToLogcat: false,
		});
		expect(
			developerSettingsSchema.safeParse({ albumCacheRequestIntervalMs: 499 })
				.success,
		).toBe(false);
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
			developerSettingsSchema.safeParse({ directMediaCacheMb: 501 }).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ directMediaCacheConcurrency: 5 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ sharedAlbumRefreshSeconds: 29 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ albumPreloadTimeoutMs: 120_001 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ conversationSearchDebounceMs: 49 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ legacyShortVideoFetchMaxMb: 101 })
				.success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({
				legacyShortVideoFetchTimeoutMs: 4_999,
			}).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({
				messageDuplicateReconcileWindowMs: 30_001,
			}).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({
				apiCircuitWindowSize: 20,
				apiCircuitMinimumSamples: 21,
			}).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({ browseAgeScaleMin: 102 }).success,
		).toBe(false);
		expect(
			developerSettingsSchema.safeParse({
				browseAgeScaleMin: 60,
				browseAgeScaleMax: 55,
			}).success,
		).toBe(false);
	});

	it("accepts supported video-call quality presets", () => {
		for (const preset of ["auto", "high", "low"]) {
			expect(videoCallQualityPresetSchema.parse(preset)).toBe(preset);
		}
		expect(videoCallQualityPresetSchema.safeParse("ultra").success).toBe(false);
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

	it("keeps received media available by default while preserving opt-outs", () => {
		expect(parsePreferences({}).keepUnavailableCachedAlbums).toBe(true);
		expect(parsePreferences({}).retainSharedChatMedia).toBe(true);
		expect(
			parsePreferences({ keepUnavailableCachedAlbums: false })
				.keepUnavailableCachedAlbums,
		).toBe(false);
		expect(
			parsePreferences({ retainSharedChatMedia: false }).retainSharedChatMedia,
		).toBe(false);
	});

	it("migrates the short-video cache limit into the direct-media limit", () => {
		expect(
			parsePreferences({
				developerSettings: { shortVideoCacheMb: 125 },
			}).developerSettings.directMediaCacheMb,
		).toBe(125);
	});

	it("keeps bottom navigation behind the keyboard by default", () => {
		expect(parsePreferences({}).keepBottomNavigationBehindKeyboard).toBe(true);
		expect(
			parsePreferences({ keepBottomNavigationBehindKeyboard: false })
				.keepBottomNavigationBehindKeyboard,
		).toBe(false);
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
