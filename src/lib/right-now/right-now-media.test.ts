import { describe, expect, it } from "vitest";

import type { FeedPost } from "./posts";
import { createRightNowMediaSession } from "./right-now-media";

function post(id: number, mediaIds: number[]): FeedPost {
	return {
		displayName: `Profile ${id}`,
		distance: null,
		expiration: 10_000,
		hosting: false,
		id,
		media: mediaIds.map((mediaId) => ({
			mediaId,
			thumbnailUrl: `https://example.test/${mediaId}-thumb.jpg`,
			fullImageUrl: `https://example.test/${mediaId}.jpg`,
			shouldBlur: false,
		})),
		mediaHash: null,
		onlineUntil: null,
		posted: id,
		profileId: id + 100,
		text: null,
	};
}

describe("Right Now logical media session", () => {
	it("includes media from every loaded logical post when opening a mounted post", () => {
		const session = createRightNowMediaSession(
			[post(10, [101, 102]), post(20, [201])],
			"10:102",
		);

		expect(session).toEqual({
			index: 1,
			dataSource: [
				{
					src: "https://example.test/101.jpg",
					msrc: "https://example.test/101-thumb.jpg",
					width: 1,
					height: 1,
				},
				{
					src: "https://example.test/102.jpg",
					msrc: "https://example.test/102-thumb.jpg",
					width: 1,
					height: 1,
				},
				{
					src: "https://example.test/201.jpg",
					msrc: "https://example.test/201-thumb.jpg",
					width: 1,
					height: 1,
				},
			],
		});
	});
});
