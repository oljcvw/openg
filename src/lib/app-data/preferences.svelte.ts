import z from "zod";
import { existsAppDataFile, readAppDataFile, writeAppDataFile } from ".";
import { decode, encode } from "@msgpack/msgpack";
import { geohashSchema } from "$lib/model/geohash";
import { gridSearchFiltersSchema } from "$lib/components/filters/filters";

export const APP_DATA_FILES = {
	preferences: "preferences.data",
} as const;

const preferencesSchema = z.object({
	geohash: geohashSchema.nullable(),
	gridSearchFilters: gridSearchFiltersSchema.optional(),
});

export async function getPreferences(): Promise<
	z.infer<typeof preferencesSchema>
> {
	if (await existsAppDataFile(APP_DATA_FILES.preferences)) {
		return await readAppDataFile(APP_DATA_FILES.preferences)
			.then(decode)
			.then((data) => preferencesSchema.parse(data));
	} else {
		return {
			geohash: null,
		};
	}
}

export async function setPreferences(
	newValues: Partial<z.infer<typeof preferencesSchema>>,
): Promise<void> {
	const oldValues = await getPreferences();
	const preferences = {
		...oldValues,
		...newValues,
	};
	preferencesSchema.parse(preferences);
	await writeAppDataFile(APP_DATA_FILES.preferences, encode(preferences));
}
