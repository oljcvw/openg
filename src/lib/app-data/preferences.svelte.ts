import { decode, encode } from "@msgpack/msgpack";
import { toast } from "svelte-sonner";
import z from "zod";

import {
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

const preferencesSchema = z
	.object({
		contrastMode: contrastModeSchema.default("standard"),
		geohash: geohashSchema.nullable().default(null),
		gridSearchFilters: gridSearchFiltersSchema.optional(),
		gridColumns: gridColumnsSchema.default("auto"),
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

export function getContrastModeSnapshot(): ContrastMode {
	return preferencesSnapshot.contrastMode;
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
	await enqueueWrite(async () => {
		const oldValues = await getPreferences();
		const preferences = parsePreferences({
			...oldValues,
			...newValues,
		});
		await writeAppDataFileAtomic("preferences.data", encode(preferences));
		cache = preferences;
		preferencesSnapshot = preferences;
		notifyPreferenceListeners();
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
