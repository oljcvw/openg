import z from "zod";

import {
	AcceptNSFWPics,
	BodyType,
	HealthPractice,
	LookingFor,
	MeetAt,
	RelationshipStatus,
	SexualPosition,
	Tribe,
} from "$lib/model/users/profiles";

export const filterIsFavoriteSchema = z.boolean();
export const filterIsOnlineSchema = z.boolean();
export const filterIsRightNowSchema = z.boolean();
export const filterIsFreshSchema = z.boolean();

export const AGE_MIN = 18;
export const AGE_MAX = 102;

export const browseAgeScaleSchema = z
	.object({
		min: z
			.number()
			.int()
			.min(AGE_MIN)
			.max(AGE_MAX - 1),
		max: z.number().int().min(AGE_MIN).max(AGE_MAX),
	})
	.refine(({ min, max }) => min <= max, {
		message: "Browse age scale minimum cannot exceed its maximum",
		path: ["min"],
	});
export type BrowseAgeScale = z.infer<typeof browseAgeScaleSchema>;
export const DEFAULT_BROWSE_AGE_SCALE: BrowseAgeScale = {
	min: AGE_MIN,
	max: AGE_MAX,
};

export function clampAgeRange(
	[from, to]: readonly number[],
	{ min, max }: BrowseAgeScale,
): [number, number] {
	const lower = Math.min(Math.max(from ?? min, min), max);
	const upper = Math.min(Math.max(to ?? max, min), max);
	return lower <= upper ? [lower, upper] : [upper, lower];
}

export function isCustomBrowseAgeScale({ min, max }: BrowseAgeScale): boolean {
	return min !== AGE_MIN || max !== AGE_MAX;
}

export function browseAgeScaleLabel({ min, max }: BrowseAgeScale): string {
	return max === AGE_MAX ? `${min}–and over` : `${min}–${max}`;
}

export const ageRangeLabel = ([from, to]: number[]) =>
	to === AGE_MAX ? `${from} years & over` : `${from} - ${to}`;

export const filterAgeEnabledSchema = z.boolean();
export const filterAgeSchema = z
	.array(z.number().min(AGE_MIN).max(AGE_MAX))
	.length(2);

export const filterGendersEnabledSchema = z.boolean().default(false);
export const filterGendersSchema = z.array(
	z.int().nonnegative().or(z.literal(-1)),
);

export const filterTagsEnabledSchema = z.boolean();
export const filterTagsSchema = z.array(z.string());

export const filterPositionEnabledSchema = z.boolean();
export const FilterPosition = {
	...SexualPosition,
	NotSpecified: -1,
} as const;
export type FilterPositionId =
	(typeof FilterPosition)[keyof typeof FilterPosition];
export const filterPositionSchema = z.array(z.enum(FilterPosition));

export const filterPhotosEnabledSchema = z.boolean();
export const filterPhotosSchema = z.array(
	z.enum(["has-photos", "has-face-pics", "has-albums"]),
);

export const filterTribesEnabledSchema = z.boolean();
export const FilterTribe = {
	...Tribe,
	NotSpecified: -1,
} as const;
export type FilterTribeId = (typeof FilterTribe)[keyof typeof FilterTribe];
export const filterTribesSchema = z.array(z.enum(FilterTribe));

export const filterBodyTypeEnabledSchema = z.boolean();
export const FilterBodyType = {
	...BodyType,
	NotSpecified: -1,
} as const;
export type FilterBodyTypeId =
	(typeof FilterBodyType)[keyof typeof FilterBodyType];
export const filterBodyTypeSchema = z.array(z.enum(FilterBodyType));

export const filterHeightEnabledSchema = z.boolean();
export const filterHeightSchema = z
	.array(z.number().min(120).max(242))
	.length(2);

export const filterWeightEnabledSchema = z.boolean();
export const filterWeightSchema = z
	.array(z.number().min(40).max(273))
	.length(2);

export const filterRelationshipStatusEnabledSchema = z.boolean();
export const FilterRelationshipStatus = {
	...RelationshipStatus,
	NotSpecified: -1,
} as const;
export type FilterRelationshipStatusId =
	(typeof FilterRelationshipStatus)[keyof typeof FilterRelationshipStatus];
export const filterRelationshipStatusSchema = z.array(
	z.enum(FilterRelationshipStatus),
);

export const filterAcceptNSFWPicsEnabledSchema = z.boolean();
export const FilterAcceptNSFWPics = {
	...AcceptNSFWPics,
	NotSpecified: -1,
} as const;
export type FilterAcceptNSFWPicsId =
	(typeof FilterAcceptNSFWPics)[keyof typeof FilterAcceptNSFWPics];
export const filterAcceptNSFWPicsSchema = z.array(z.enum(FilterAcceptNSFWPics));

export const filterLookingForEnabledSchema = z.boolean();
export const FilterLookingFor = {
	...LookingFor,
	NotSpecified: -1,
} as const;
export type FilterLookingForId =
	(typeof FilterLookingFor)[keyof typeof FilterLookingFor];
export const filterLookingForSchema = z.array(z.enum(FilterLookingFor));

export const filterMeetAtEnabledSchema = z.boolean();
export const FilterMeetAt = {
	...MeetAt,
	NotSpecified: -1,
} as const;
export type FilterMeetAtId = (typeof FilterMeetAt)[keyof typeof FilterMeetAt];
export const filterMeetAtSchema = z.array(z.enum(FilterMeetAt));

export const filterHaventChattedTodayEnabledSchema = z.boolean();

export const filterHealthPracticesEnabledSchema = z.boolean();
export const FilterHealthPractice = {
	...HealthPractice,
	NotSpecified: -1,
} as const;
export type FilterHealthPracticeId =
	(typeof FilterHealthPractice)[keyof typeof FilterHealthPractice];
export const filterHealthPracticesSchema = z.array(
	z.enum(FilterHealthPractice),
);

export const gridSearchFiltersSchema = z.object({
	isFavorite: filterIsFavoriteSchema.default(false),
	isOnline: filterIsOnlineSchema.default(false),
	isRightNow: filterIsRightNowSchema.default(false),

	ageEnabled: filterAgeEnabledSchema.default(false),
	age: filterAgeSchema.default([AGE_MIN, AGE_MAX]),

	genderEnabled: filterGendersEnabledSchema.default(false),
	genders: filterGendersSchema.default([]),

	tagsEnabled: filterTagsEnabledSchema.default(false),
	tags: filterTagsSchema.default([]),

	positionEnabled: filterPositionEnabledSchema.default(false),
	positions: filterPositionSchema.default([]),

	photosEnabled: filterPhotosEnabledSchema.default(false),
	photos: filterPhotosSchema.default([]),

	tribesEnabled: filterTribesEnabledSchema.default(false),
	tribes: filterTribesSchema.default([]),

	bodyTypesEnabled: filterBodyTypeEnabledSchema.default(false),
	bodyTypes: filterBodyTypeSchema.default([]),

	heightEnabled: filterHeightEnabledSchema.default(false),
	height: filterHeightSchema.default([120, 242]),

	weightEnabled: filterWeightEnabledSchema.default(false),
	weight: filterWeightSchema.default([40, 273]),

	relationshipStatusesEnabled:
		filterRelationshipStatusEnabledSchema.default(false),
	relationshipStatuses: filterRelationshipStatusSchema.default([]),

	acceptNSFWPicsEnabled: filterAcceptNSFWPicsEnabledSchema.default(false),
	acceptNSFWPics: filterAcceptNSFWPicsSchema.default([]),

	lookingForEnabled: filterLookingForEnabledSchema.default(false),
	lookingFor: filterLookingForSchema.default([]),

	meetAtEnabled: filterMeetAtEnabledSchema.default(false),
	meetAt: filterMeetAtSchema.default([]),

	haventChattedTodayEnabled:
		filterHaventChattedTodayEnabledSchema.default(false),

	healthPracticesEnabled: filterHealthPracticesEnabledSchema.default(false),
	healthPractices: filterHealthPracticesSchema.default([]),

	isFresh: filterIsFreshSchema.default(false),
});

export type GridSearchFilters = z.infer<typeof gridSearchFiltersSchema>;

export const defaultFilters: GridSearchFilters = gridSearchFiltersSchema.parse(
	{},
);

export const filterRightNowSortSchema = z.enum(["DISTANCE", "NEWEST"]);

export const rightNowFiltersSchema = z.object({
	sort: filterRightNowSortSchema.default("DISTANCE"),
	hosting: z.boolean().nullable().default(null),
	ageEnabled: filterAgeEnabledSchema.default(false),
	age: filterAgeSchema.default([AGE_MIN, AGE_MAX]),
	positionEnabled: filterPositionEnabledSchema.default(false),
	positions: filterPositionSchema.default([]),
});

export type RightNowFilters = z.infer<typeof rightNowFiltersSchema>;

export const defaultRightNowFilters: RightNowFilters =
	rightNowFiltersSchema.parse({});
