import type { FeedPost } from "./posts";

export type RightNowMediaSlide = {
	src: string;
	msrc: string;
	width: number;
	height: number;
};

export function createRightNowMediaSession(
	posts: readonly FeedPost[],
	startKey: string,
): { index: number; dataSource: RightNowMediaSlide[] } | null {
	const entries = posts.flatMap((post) =>
		post.media.map((media) => ({
			key: `${post.id}:${media.mediaId}`,
			slide: {
				src: media.fullImageUrl,
				msrc: media.thumbnailUrl,
				width: 1,
				height: 1,
			},
		})),
	);
	const index = entries.findIndex((entry) => entry.key === startKey);
	if (index === -1) return null;
	return { index, dataSource: entries.map((entry) => entry.slide) };
}
