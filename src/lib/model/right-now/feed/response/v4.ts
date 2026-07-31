import z from "zod";

import { mediaUrlSchema } from "$lib/model/media";
import { unixTimestampMsSchema } from "$lib/model/types";

export const rightNowPostMediaItemSchema = z.object({
	type: z.string(),
	data: z.object({
		mediaId: z.int(),
		thumbnailUrl: mediaUrlSchema,
		fullImageUrl: mediaUrlSchema,
		contentType: z.string(),
		state: z.string(),
		reason: z.string().nullable().optional(),
		isRejectAutomated: z.boolean().nullable().optional(),
		shouldBlur: z.boolean(),
		isNsfw: z.boolean(),
		source: z.string(),
	}),
});

export const rightNowPostDataSchema = z.object({
	"@type": z.string(),
	id: z.int(),
	profileId: z.int().nonnegative(),
	mediaHash: z.string().optional(),
	displayName: z.string().optional(),
	media: z.array(rightNowPostMediaItemSchema),
	text: z.string().optional(),
	distance: z.int().nonnegative().optional(),
	hosting: z.boolean(),
	posted: unixTimestampMsSchema,
	expiration: unixTimestampMsSchema,
	onlineUntil: unixTimestampMsSchema.optional(),
	mpuScore: z.number().optional(),
	recentlyChatted: z.boolean(),
	favorite: z.boolean(),
});

export const rightNowFeedPostItemSchema = z.object({
	type: z.enum(["right_now_post_v3", "locked_post_v1"]),
	data: rightNowPostDataSchema,
});

/**
 * Feed item kinds are server-extensible. Validate the response envelope here,
 * then parse only post kinds understood by this client.
 */
export const rightNowFeedResponseSchema = z.object({
	items: z.array(z.unknown()),
	viewerCount: z.int().nonnegative(),
});

export type RightNowFeedResponse = z.infer<typeof rightNowFeedResponseSchema>;
