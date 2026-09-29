import type z from "zod";

import {
<<<<<<< HEAD
	type GridSearchFilters,
=======
	AGE_MAX,
	AGE_MIN,
	type GridSearchFilters,
	HEIGHT_CM_MAX,
	HEIGHT_CM_MIN,
	isFilterableGenderId,
	isFilterableTagKey,
	isFilterableTribe,
	isFullRange,
	WEIGHT_GRAMS_MAX,
	WEIGHT_GRAMS_MIN,
>>>>>>> origin/forgejo-sync
	WEIGHT_KG_MAX,
	WEIGHT_KG_MIN,
} from "$lib/model/browse/grid/filters";
import type { cascadeV4QuerySchema } from "$lib/model/browse/grid/cascade/query/v4";

<<<<<<< HEAD
=======
const sendable = <T>({ enabled, values }: { enabled: boolean; values: T[] }) =>
	enabled && values.length > 0 ? values : undefined;

const sendableRange = ({
	enabled,
	range,
	min,
	max,
}: {
	enabled: boolean;
	range: number[];
	min: number;
	max: number;
}) => (enabled && !isFullRange({ range, min, max }) ? range : undefined);

const weightGrams = ({
	kg,
	end,
	endGrams,
}: {
	kg: number | undefined;
	end: number;
	endGrams: number;
}) => (kg === undefined || kg === end ? endGrams : kg * 1000);

type CascadeQuery = z.infer<typeof cascadeV4QuerySchema>;
type CascadeFilters = Omit<CascadeQuery, "nearbyGeoHash">;

>>>>>>> origin/forgejo-sync
export function buildCascadeQuery({
	geohash,
	filters,
}: {
	geohash: string;
	filters: GridSearchFilters | null;
<<<<<<< HEAD
}): z.infer<typeof cascadeV4QuerySchema> {
	if (!filters) return { nearbyGeoHash: geohash };
	return {
		nearbyGeoHash: geohash,
		favorites: filters.isFavorite || undefined,
		onlineOnly: filters.isOnline || undefined,
		rightNow: filters.isRightNow || undefined,
		...(filters.ageEnabled && {
			ageMin: filters.age[0],
			ageMax: filters.age[1],
		}),
		...(filters.genderEnabled && { genders: filters.genders }),
		...(filters.positionEnabled && { sexualPositions: filters.positions }),
		...(filters.photosEnabled &&
			filters.photos.includes("has-photos") && { photoOnly: true }),
		...(filters.photosEnabled &&
			filters.photos.includes("has-albums") && { hasAlbum: true }),
		...(filters.photosEnabled &&
			filters.photos.includes("has-face-pics") && { faceOnly: true }),
		...(filters.tribesEnabled && { tribes: filters.tribes }),
		...(filters.bodyTypesEnabled && { bodyTypes: filters.bodyTypes }),
		...(filters.heightEnabled && {
			heightCmMin: filters.height[0],
			heightCmMax: filters.height[1],
		}),
		...(filters.weightEnabled && {
			weightGramsMin: (filters.weight[0] ?? WEIGHT_KG_MIN) * 1000,
			weightGramsMax: (filters.weight[1] ?? WEIGHT_KG_MAX) * 1000,
		}),
		...(filters.relationshipStatusesEnabled && {
			relationshipStatuses: filters.relationshipStatuses,
		}),
		...(filters.acceptNSFWPicsEnabled &&
			filters.acceptNSFWPics !== undefined && {
				nsfwPics: filters.acceptNSFWPics,
			}),
		...(filters.lookingForEnabled && { lookingFor: filters.lookingFor }),
		...(filters.meetAtEnabled && { meetAt: filters.meetAt }),
		notRecentlyChatted: filters.haventChattedTodayEnabled || undefined,
		...(filters.healthPracticesEnabled && {
			sexualHealth: filters.healthPractices,
		}),
		...(filters.tagsEnabled && filters.tags && { tags: filters.tags }),
=======
}): CascadeQuery {
	return { nearbyGeoHash: geohash, ...(filters && cascadeFilters(filters)) };
}

export function sentFilterKeys(
	filters: GridSearchFilters,
): (keyof CascadeFilters)[] {
	return Object.entries(cascadeFilters(filters))
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key as keyof CascadeFilters);
}

function cascadeFilters(filters: GridSearchFilters): CascadeFilters {
	const age = sendableRange({
		enabled: filters.ageEnabled,
		range: filters.age,
		min: AGE_MIN,
		max: AGE_MAX,
	});
	const height = sendableRange({
		enabled: filters.heightEnabled,
		range: filters.height,
		min: HEIGHT_CM_MIN,
		max: HEIGHT_CM_MAX,
	});
	const weight = sendableRange({
		enabled: filters.weightEnabled,
		range: filters.weight,
		min: WEIGHT_KG_MIN,
		max: WEIGHT_KG_MAX,
	});
	return {
		favorites: filters.isFavorite || undefined,
		onlineOnly: filters.isOnline || undefined,
		rightNow: filters.isRightNow || undefined,
		...(age && { ageMin: age[0], ageMax: age[1] }),
		genders: sendable({
			enabled: filters.genderEnabled,
			values: filters.genders.filter(isFilterableGenderId),
		}),
		sexualPositions: sendable({
			enabled: filters.positionEnabled,
			values: filters.positions,
		}),
		photoOnly:
			(filters.photosEnabled && filters.photos.includes("has-photos")) ||
			undefined,
		hasAlbum:
			(filters.photosEnabled && filters.photos.includes("has-albums")) ||
			undefined,
		faceOnly:
			(filters.photosEnabled &&
				filters.photos.includes("has-face-pics")) ||
			undefined,
		tribes: sendable({
			enabled: filters.tribesEnabled,
			values: filters.tribes.filter(isFilterableTribe),
		}),
		bodyTypes: sendable({
			enabled: filters.bodyTypesEnabled,
			values: filters.bodyTypes,
		}),
		...(height && { heightCmMin: height[0], heightCmMax: height[1] }),
		...(weight && {
			weightGramsMin: weightGrams({
				kg: weight[0],
				end: WEIGHT_KG_MIN,
				endGrams: WEIGHT_GRAMS_MIN,
			}),
			weightGramsMax: weightGrams({
				kg: weight[1],
				end: WEIGHT_KG_MAX,
				endGrams: WEIGHT_GRAMS_MAX,
			}),
		}),
		relationshipStatuses: sendable({
			enabled: filters.relationshipStatusesEnabled,
			values: filters.relationshipStatuses,
		}),
		nsfwPics: sendable({
			enabled: filters.acceptNSFWPicsEnabled,
			values: filters.acceptNSFWPics,
		}),
		lookingFor: sendable({
			enabled: filters.lookingForEnabled,
			values: filters.lookingFor,
		}),
		meetAt: sendable({
			enabled: filters.meetAtEnabled,
			values: filters.meetAt,
		}),
		notRecentlyChatted: filters.haventChattedTodayEnabled || undefined,
		sexualHealth: sendable({
			enabled: filters.healthPracticesEnabled,
			values: filters.healthPractices,
		}),
		tags: sendable({
			enabled: filters.tagsEnabled,
			values: filters.tags.filter(isFilterableTagKey),
		}),
>>>>>>> origin/forgejo-sync
		fresh: filters.isFresh || undefined,
	};
}
