import type { RightNowFeedResponse } from "$lib/model/right-now/feed/response/v4";
import { HOUR, MINUTE, NOW } from "../config";
import {
	distanceForId,
	onlineUntilOf,
	photosOf,
	profileSeed,
} from "./profiles";

const POST_COUNT = 30;
const FIRST_PROFILE_ID = 100_001;

function createPost(profileId: number, index: number) {
	const seed = profileSeed(profileId);
	const mediaId = profileId * 10;
	const posted = NOW - index * 2 * MINUTE;
	const hasImage = index % 3 === 0;
	return {
		type: index % 5 === 0 ? "locked_post_v1" : "right_now_post_v3",
		data: {
			"@type":
				index % 5 === 0
					? "RightNowFeedItemData$LockedPostV1"
					: "RightNowFeedItemData$RightNowPostV3",
			id: profileId * 2,
			profileId,
			mediaHash: photosOf(profileId)[0],
			displayName: seed.name ?? undefined,
			media: hasImage
				? [
						{
							type: "image_v1",
							data: {
								mediaId,
								thumbnailUrl: `https://picsum.photos/seed/right-now-${mediaId}/480/360`,
								fullImageUrl: `https://picsum.photos/seed/right-now-${mediaId}/1280/960`,
								contentType: "image/jpeg",
								state: "APPROVED",
								reason: null,
								isRejectAutomated: null,
								shouldBlur: false,
								isNsfw: false,
								source: "RIGHT_NOW",
							},
						},
					]
				: [],
			text:
				index % 2 === 0
					? `Free ${index % 4 === 0 ? "now" : "later"}?`
					: undefined,
			distance: index % 7 === 0 ? undefined : distanceForId(profileId),
			hosting: index % 4 === 0,
			posted,
			expiration: posted + 2 * HOUR,
			onlineUntil: onlineUntilOf(seed) ?? undefined,
			mpuScore: index,
			recentlyChatted: false,
			favorite: seed.favorite,
		},
	};
}

const posts = Array.from({ length: POST_COUNT }, (_, index) =>
	createPost(FIRST_PROFILE_ID + index, index),
);

export function demoRightNowFeed(
	params: URLSearchParams,
): RightNowFeedResponse {
	const hosting = params.get("hosting");
	const ageMin = Number(params.get("ageMin")) || null;
	const ageMax = Number(params.get("ageMax")) || null;
	const positions = params.get("sexualPositions")?.split(",").map(Number);
	const newest = params.get("sort") === "NEWEST";

	const items = posts
		.filter((post) => {
			const profile = profileSeed(post.data.profileId);
			if (hosting !== null && post.data.hosting !== (hosting === "true"))
				return false;
			if (ageMin !== null && (profile.age === null || profile.age < ageMin))
				return false;
			if (ageMax !== null && (profile.age === null || profile.age > ageMax))
				return false;
			if (
				positions &&
				(profile.position === null || !positions.includes(profile.position))
			)
				return false;
			return true;
		})
		.toSorted((a, b) =>
			newest
				? b.data.posted - a.data.posted
				: (a.data.distance ?? Infinity) - (b.data.distance ?? Infinity),
		);

	return { items, viewerCount: 147 };
}
