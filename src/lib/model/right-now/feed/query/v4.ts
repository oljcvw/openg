import z from "zod";

import {
	filterPositionSchema,
	filterRightNowSortSchema,
} from "$lib/components/filters/filters";

export const rightNowV4QuerySchema = z.object({
	sort: filterRightNowSortSchema.default("DISTANCE"),
	hosting: z.boolean().optional(),
	sexualPositions: filterPositionSchema.optional(),
	ageMin: z.int().nonnegative().optional(),
	ageMax: z.int().nonnegative().optional(),
});
