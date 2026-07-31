import { getRightNowFeedV4 } from "$lib/api/right-now";
import { rightNowFeedPostItemSchema } from "$lib/model/right-now/feed/response/v4";
import { now } from "$lib/util/clock";

export type FeedPostMedia = {
	mediaId: number;
	thumbnailUrl: string;
	fullImageUrl: string;
	shouldBlur: boolean;
};

export type FeedPost = {
	displayName: string | null;
	distance: number | null;
	expiration: number;
	hosting: boolean;
	id: number;
	media: FeedPostMedia[];
	mediaHash: string | null;
	onlineUntil: number | null;
	posted: number;
	profileId: number;
	text: string | null;
};

export type FeedSnapshot = {
	posts: FeedPost[];
	viewerCount: number;
};

export async function getPosts(
	query: Parameters<typeof getRightNowFeedV4>[0],
): Promise<FeedSnapshot> {
	const response = await getRightNowFeedV4(query);
	const posts = new Map<number, FeedPost>();
	const currentTime = now();

	for (const rawItem of response.items) {
		const parsed = rightNowFeedPostItemSchema.safeParse(rawItem);
		if (!parsed.success) continue;

		const post = parsed.data.data;
		if (post.expiration <= currentTime) continue;
		posts.set(post.id, {
			displayName: post.displayName ?? null,
			distance: post.distance ?? null,
			expiration: post.expiration,
			hosting: post.hosting,
			id: post.id,
			media: post.media.map(({ data }) => ({
				mediaId: data.mediaId,
				thumbnailUrl: data.thumbnailUrl,
				fullImageUrl: data.fullImageUrl,
				shouldBlur: data.shouldBlur,
			})),
			mediaHash: post.mediaHash ?? null,
			onlineUntil: post.onlineUntil ?? null,
			posted: post.posted,
			profileId: post.profileId,
			text: post.text ?? null,
		});
	}

	return { posts: [...posts.values()], viewerCount: response.viewerCount };
}
