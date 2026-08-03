import { decode, encode } from "@msgpack/msgpack";
import { toast } from "svelte-sonner";
import z from "zod";

import {
	AGE_MAX,
	AGE_MIN,
	type BrowseAgeScale,
	browseAgeScaleSchema,
	clampAgeRange,
	DEFAULT_BROWSE_AGE_SCALE,
	defaultFilters,
	type GridSearchFilters,
	gridSearchFiltersSchema,
	rightNowFiltersSchema,
} from "$lib/components/filters/filters";
import { geohashSchema } from "$lib/model/geohash";
import {
	getLocationActivity,
	type LocationActivity,
	reportedProfileLocationSchema,
} from "$lib/model/location";
import { type UnitSystem, unitSystemSchema } from "$lib/util/units";
import { existsAppDataFile, readAppDataFile, writeAppDataFileAtomic } from ".";

export const gridColumnsSchema = z.union([
	z.literal("auto"),
	z.number().int().min(2).max(7),
]);
export type GridColumns = z.infer<typeof gridColumnsSchema>;

export const contrastModeSchema = z.enum(["standard", "high"]);
export type ContrastMode = z.infer<typeof contrastModeSchema>;

export const videoCallQualityPresetSchema = z.enum(["auto", "high", "low"]);
export type VideoCallQualityPreset = z.infer<
	typeof videoCallQualityPresetSchema
>;

export const developerSettingsSchema = z
	.object({
		albumCacheCdnRetryLimit: z.number().int().min(0).max(5).default(2),
		albumCacheMediaConcurrency: z.number().int().min(1).max(4).default(2),
		albumCacheRequestIntervalMs: z
			.number()
			.int()
			.min(500)
			.max(30_000)
			.default(2_000),
		albumCacheValidationMinutes: z.number().int().min(5).max(1_440).default(60),
		albumPreloadConcurrency: z.number().int().min(1).max(8).default(3),
		browseAgeScaleMax: z
			.number()
			.int()
			.min(AGE_MIN)
			.max(AGE_MAX)
			.default(AGE_MAX),
		browseAgeScaleMin: z
			.number()
			.int()
			.min(AGE_MIN)
			.max(AGE_MAX - 1)
			.default(AGE_MIN),
		apiCircuitFailurePercent: z.number().int().min(25).max(50).default(50),
		apiCircuitMinimumSamples: z.number().int().min(5).max(20).default(20),
		apiCircuitOpenMs: z.number().int().min(30_000).max(300_000).default(30_000),
		apiCircuitWindowSize: z.number().int().min(20).max(100).default(50),
		apiProtectionCooldownMs: z
			.number()
			.int()
			.min(30_000)
			.max(300_000)
			.default(30_000),
		apiRequestTimeoutMs: z
			.number()
			.int()
			.min(5_000)
			.max(120_000)
			.default(35_000),
		notificationPollIntervalMinutes: z
			.number()
			.int()
			.min(15)
			.max(1_440)
			.default(15),
		placeSearchCacheEntries: z.number().int().min(1).max(100).default(20),
		profileResolutionBatchSize: z.number().int().min(1).max(30).default(30),
		profileResolutionWindowMs: z.number().int().min(0).max(1_000).default(16),
		reconcileThrottleMs: z.number().int().min(2_000).max(30_000).default(2_000),
		shortVideoCacheMb: z.number().int().min(10).max(500).default(30),
		shortVideoLooping: z.boolean().default(false),
		videoCallQualityPreset: videoCallQualityPresetSchema.default("auto"),
		mediaDiagnostics: z.boolean().default(false),
		logErrorsToLogcat: z.boolean().default(false),
	})
	.refine(
		(settings) =>
			settings.apiCircuitMinimumSamples <= settings.apiCircuitWindowSize,
		{
			message: "Circuit minimum samples cannot exceed the circuit window",
			path: ["apiCircuitMinimumSamples"],
		},
	)
	.refine(
		(settings) => settings.browseAgeScaleMin <= settings.browseAgeScaleMax,
		{
			message: "Browse age scale minimum cannot exceed its maximum",
			path: ["browseAgeScaleMin"],
		},
	);
export type DeveloperSettings = z.infer<typeof developerSettingsSchema>;
type DedicatedDeveloperSetting = "browseAgeScaleMax" | "browseAgeScaleMin";
export type GeneralDeveloperSettings = Omit<
	DeveloperSettings,
	DedicatedDeveloperSetting
>;
export const DEFAULT_DEVELOPER_SETTINGS = developerSettingsSchema.parse({});

const preferencesSchema = z
	.object({
		contrastMode: contrastModeSchema.default("standard"),
		cacheSizeMb: z.number().int().min(10).max(1000).default(100),
		developerSettings: developerSettingsSchema.default(
			DEFAULT_DEVELOPER_SETTINGS,
		),
		geohash: geohashSchema.nullable().default(null),
		gridSearchFilters: gridSearchFiltersSchema.optional(),
		gridColumns: gridColumnsSchema.default("auto"),
		keepBottomNavigationBehindKeyboard: z.boolean().default(true),
		keepUnavailableCachedAlbums: z.boolean().default(false),
		profileSwipeNavigation: z.boolean().optional(),
		pendingProfileLocation: reportedProfileLocationSchema
			.nullable()
			.default(null),
		reportedProfileLocation: reportedProfileLocationSchema
			.nullable()
			.default(null),
		rightNowFilters: rightNowFiltersSchema.optional(),
		revealMessageRead: z.boolean().default(false),
		revealProfileViews: z.boolean().default(false),
		showRetractedMessages: z.boolean().default(false),
		// Removed in favor of swipe-only navigation. Keep accepting old payloads so
		// existing preferences migrate without a reset.
		showProfileNavigationButtons: z.boolean().optional(),
		stayAwake: z.boolean().default(false),
		units: unitSystemSchema.default("metric"),
		warnBeforeCopyingErrorDetails: z.boolean().default(true),
	})
	.transform((input) => {
		const { showProfileNavigationButtons, ...value } = input;
		void showProfileNavigationButtons;
		return {
			...value,
			profileSwipeNavigation: value.profileSwipeNavigation ?? true,
		};
	});

type Preferences = z.infer<typeof preferencesSchema>;

export function parsePreferences(value: unknown): Preferences {
	return preferencesSchema.parse(value);
}

let writeQueue: Promise<unknown> = Promise.resolve();
let preferencesSnapshot = $state<Preferences>(parsePreferences({}));

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = writeQueue.then(task);
	writeQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

let cache: Preferences | null = null;
let hydrating: Promise<Preferences> | null = null;
const preferenceListeners = new Set<() => void>();

function notifyPreferenceListeners(): void {
	for (const listener of preferenceListeners) listener();
}

export function subscribePreferences(listener: () => void): () => void {
	preferenceListeners.add(listener);
	return () => preferenceListeners.delete(listener);
}

async function readFromDisk(): Promise<Preferences> {
	if (!(await existsAppDataFile("preferences.data"))) {
		return parsePreferences({});
	}
	const bytes = await readAppDataFile("preferences.data");
	return parsePreferences(decode(bytes));
}

export async function getPreferences(): Promise<Preferences> {
	if (cache !== null) return structuredClone(cache);
	hydrating ??= readFromDisk()
		.then((preferences) => {
			cache = preferences;
			preferencesSnapshot = preferences;
			return preferences;
		})
		.catch((error: unknown) => {
			console.error(error);
			toast.error("Failed to load preferences. Reset to defaults?", {
				action: {
					label: "Reset",
					onClick: () => void resetToDefaults(),
				},
				duration: 10000,
				id: "load-preferences-error",
			});
			throw error;
		})
		.finally(() => {
			hydrating = null;
		});
	return structuredClone(await hydrating);
}

export function getUnitsSnapshot(): UnitSystem {
	return preferencesSnapshot.units;
}

export function getGeohashSnapshot(): string | null {
	return preferencesSnapshot.geohash;
}

export function getReportedProfileLocationSnapshot() {
	return preferencesSnapshot.reportedProfileLocation;
}

export function getPendingProfileLocationSnapshot() {
	return preferencesSnapshot.pendingProfileLocation;
}

export function getLocationActivitySnapshot(): LocationActivity {
	return getLocationActivity({
		browseGeohash: preferencesSnapshot.geohash,
		reportedProfileLocation: preferencesSnapshot.reportedProfileLocation,
		pendingProfileLocation: preferencesSnapshot.pendingProfileLocation,
	});
}

export function getGridColumnsSnapshot(): GridColumns {
	return preferencesSnapshot.gridColumns;
}

export function getKeepUnavailableCachedAlbumsSnapshot(): boolean {
	return preferencesSnapshot.keepUnavailableCachedAlbums;
}

export function getKeepBottomNavigationBehindKeyboardSnapshot(): boolean {
	return preferencesSnapshot.keepBottomNavigationBehindKeyboard;
}

export function getContrastModeSnapshot(): ContrastMode {
	return preferencesSnapshot.contrastMode;
}

export function getCacheSizeMbSnapshot(): number {
	return preferencesSnapshot.cacheSizeMb;
}

export function getDeveloperSettingsSnapshot(): DeveloperSettings {
	return preferencesSnapshot.developerSettings;
}

export function getBrowseAgeScaleSnapshot(): BrowseAgeScale {
	const { browseAgeScaleMin: min, browseAgeScaleMax: max } =
		preferencesSnapshot.developerSettings;
	return { min, max };
}

export function getProfileSwipeNavigationSnapshot(): boolean {
	return preferencesSnapshot.profileSwipeNavigation;
}

export function getStayAwakeSnapshot(): boolean {
	return preferencesSnapshot.stayAwake;
}

export function getShowRetractedMessagesSnapshot(): boolean {
	return preferencesSnapshot.showRetractedMessages;
}

export async function hydratePreferences(): Promise<void> {
	await getPreferences();
}

export async function setPreferences(
	newValues: Partial<Preferences>,
): Promise<void> {
	await updatePreferences(() => newValues);
}

async function updatePreferences(
	update: (current: Preferences) => Partial<Preferences>,
): Promise<void> {
	await enqueueWrite(async () => {
		const oldValues = await getPreferences();
		const preferences = parsePreferences({
			...oldValues,
			...update(oldValues),
		});
		await writeAppDataFileAtomic("preferences.data", encode(preferences));
		cache = preferences;
		preferencesSnapshot = preferences;
		notifyPreferenceListeners();
	});
}

export async function setDeveloperSettings(
	newValues: Partial<GeneralDeveloperSettings>,
): Promise<void> {
	if ("browseAgeScaleMin" in newValues || "browseAgeScaleMax" in newValues) {
		throw new Error("Browse age scale requires its dedicated atomic setter");
	}
	await updatePreferences((current) => ({
		developerSettings: developerSettingsSchema.parse({
			...current.developerSettings,
			...newValues,
		}),
	}));
}

export interface BrowseAgeScaleUpdateResult {
	ageSelectionClamped: boolean;
	gridSearchFilters: GridSearchFilters;
	previousAge: [number, number];
	nextAge: [number, number];
	scale: BrowseAgeScale;
}

export async function setBrowseAgeScale(
	newScale: BrowseAgeScale,
): Promise<BrowseAgeScaleUpdateResult> {
	const scale = browseAgeScaleSchema.parse(newScale);
	let result: BrowseAgeScaleUpdateResult | undefined;
	await updatePreferences((current) => {
		const filters = current.gridSearchFilters ?? defaultFilters;
		const previousAge = [...filters.age] as [number, number];
		const nextAge = clampAgeRange(previousAge, scale);
		const gridSearchFilters = gridSearchFiltersSchema.parse({
			...filters,
			age: nextAge,
		});
		result = {
			ageSelectionClamped:
				previousAge[0] !== nextAge[0] || previousAge[1] !== nextAge[1],
			gridSearchFilters,
			previousAge,
			nextAge,
			scale,
		};
		return {
			developerSettings: developerSettingsSchema.parse({
				...current.developerSettings,
				browseAgeScaleMin: scale.min,
				browseAgeScaleMax: scale.max,
			}),
			gridSearchFilters,
		};
	});
	if (!result) throw new Error("Browse age scale update did not complete");
	return result;
}

export async function resetBrowseAgeScale(): Promise<BrowseAgeScaleUpdateResult> {
	return await setBrowseAgeScale(DEFAULT_BROWSE_AGE_SCALE);
}

export async function resetDeveloperSettings(): Promise<void> {
	await setPreferences({
		developerSettings: structuredClone(DEFAULT_DEVELOPER_SETTINGS),
	});
}

async function resetToDefaults(): Promise<void> {
	await enqueueWrite(async () => {
		const preferences = parsePreferences({});
		await writeAppDataFileAtomic("preferences.data", encode(preferences));
		cache = preferences;
		preferencesSnapshot = preferences;
		notifyPreferenceListeners();
	});
	window.location.reload();
}

const accountPreferenceKeys = [
	"geohash",
	"gridSearchFilters",
	"pendingProfileLocation",
	"reportedProfileLocation",
	"rightNowFilters",
] as const;

export async function clearAccountPreferences(): Promise<void> {
	await enqueueWrite(async () => {
		const kept: Partial<Preferences> = { ...(await getPreferences()) };
		for (const key of accountPreferenceKeys) delete kept[key];
		const preferences = parsePreferences(kept);
		await writeAppDataFileAtomic("preferences.data", encode(preferences));
		cache = preferences;
		preferencesSnapshot = preferences;
		notifyPreferenceListeners();
	});
}
