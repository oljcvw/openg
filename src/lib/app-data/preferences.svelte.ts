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

export const inboxLayoutModeSchema = z.enum(["adaptive", "stacked"]);
export type InboxLayoutMode = z.infer<typeof inboxLayoutModeSchema>;

export const inboxRowDensitySchema = z.enum([
	"compact",
	"comfortable",
	"roomy",
]);
export type InboxRowDensity = z.infer<typeof inboxRowDensitySchema>;

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
		albumPreloadTimeoutMs: z
			.number()
			.int()
			.min(5_000)
			.max(120_000)
			.default(30_000),
		conversationSearchDebounceMs: z
			.number()
			.int()
			.min(50)
			.max(2_000)
			.default(250),
		cacheManifestTouchIntervalMinutes: z
			.number()
			.int()
			.min(1)
			.max(1_440)
			.default(60),
		navigationTransitionTimeoutMs: z
			.number()
			.int()
			.min(2_000)
			.max(30_000)
			.default(8_000),
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
		profileCacheMaxEntries: z.number().int().min(100).max(2_000).default(500),
		conversationSearchConcurrency: z.number().int().min(1).max(6).default(3),
		albumShareDiscoveryConcurrency: z.number().int().min(1).max(8).default(3),
		profileResolutionBatchSize: z.number().int().min(1).max(30).default(30),
		profileResolutionWindowMs: z.number().int().min(0).max(1_000).default(16),
		reconcileThrottleMs: z.number().int().min(2_000).max(30_000).default(2_000),
		directMediaCacheConcurrency: z.number().int().min(1).max(4).default(2),
		directMediaCacheMb: z.number().int().min(10).max(500).optional(),
		legacyShortVideoFetchMaxMb: z.number().int().min(10).max(100).default(30),
		legacyShortVideoFetchTimeoutMs: z
			.number()
			.int()
			.min(5_000)
			.max(120_000)
			.default(30_000),
		messageDuplicateReconcileWindowMs: z
			.number()
			.int()
			.min(1_000)
			.max(30_000)
			.default(5_000),
		sharedAlbumRefreshSeconds: z.number().int().min(30).max(600).default(150),
		// Accepted only to migrate preferences written before the direct-media
		// cache generalized the Android short-video cache.
		shortVideoCacheMb: z.number().int().min(10).max(500).optional(),
		shortVideoLooping: z.boolean().default(false),
		videoCallQualityPreset: videoCallQualityPresetSchema.default("auto"),
		mediaDiagnostics: z.boolean().default(false),
		logErrorsToLogcat: z.boolean().default(false),
	})
	.transform(({ shortVideoCacheMb, ...settings }) => ({
		...settings,
		directMediaCacheMb: settings.directMediaCacheMb ?? shortVideoCacheMb ?? 30,
	}))
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
		storageVersion: z.literal(2).default(2),
		contrastMode: contrastModeSchema.default("standard"),
		cacheSizeMb: z.number().int().min(10).max(1000).default(100),
		developerSettings: developerSettingsSchema.default(
			DEFAULT_DEVELOPER_SETTINGS,
		),
		geohash: geohashSchema.nullable().default(null),
		gridSearchFilters: gridSearchFiltersSchema.optional(),
		gridColumns: gridColumnsSchema.default("auto"),
		inboxLayoutMode: inboxLayoutModeSchema.default("adaptive"),
		inboxRowDensity: inboxRowDensitySchema.default("comfortable"),
		keepBottomNavigationBehindKeyboard: z.boolean().default(true),
		keepUnavailableCachedAlbums: z.boolean().default(true),
		manualLocationActive: z.boolean().default(false),
		retainSharedChatMedia: z.boolean().default(true),
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
			manualLocationActive:
				value.manualLocationActive ||
				value.reportedProfileLocation?.source === "manual",
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
	const decoded = decode(bytes);
	const preferences = parsePreferences(decoded);
	if (
		typeof decoded !== "object" ||
		decoded === null ||
		!("storageVersion" in decoded) ||
		decoded.storageVersion !== 2
	) {
		await writeAppDataFileAtomic("preferences.data", encode(preferences));
	}
	return preferences;
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

export function getPreferencesSnapshot(): Preferences {
	return preferencesSnapshot;
}

export function preferencesLoaded(): boolean {
	return cache !== null;
}

export function getReportedProfileLocationSnapshot() {
	return preferencesSnapshot.reportedProfileLocation;
}

export function getPendingProfileLocationSnapshot() {
	return preferencesSnapshot.pendingProfileLocation;
}

export function getManualLocationActiveSnapshot(): boolean {
	return preferencesSnapshot.manualLocationActive;
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

export function getInboxLayoutModeSnapshot(): InboxLayoutMode {
	return preferencesSnapshot.inboxLayoutMode;
}

export function getInboxRowDensitySnapshot(): InboxRowDensity {
	return preferencesSnapshot.inboxRowDensity;
}

export function getKeepUnavailableCachedAlbumsSnapshot(): boolean {
	return preferencesSnapshot.keepUnavailableCachedAlbums;
}

export function getRetainSharedChatMediaSnapshot(): boolean {
	return preferencesSnapshot.retainSharedChatMedia;
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
	"manualLocationActive",
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
