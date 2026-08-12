import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRightNowFeedMock } = vi.hoisted(() => ({
	getRightNowFeedMock: vi.fn(),
}));

vi.mock("$lib/api/right-now", () => ({
	getRightNowFeedV4: getRightNowFeedMock,
}));

import { resetNowForTesting, setNowForTesting } from "$lib/util/clock";
import { getPosts } from "./posts";

function item({
	id,
	expiration = 2_000,
	displayName = `Profile ${id}`,
}: {
	id: number;
	expiration?: number;
	displayName?: string;
}) {
	return {
		type: "right_now_post_v3",
		data: {
			"@type": "RightNowFeedItemData$RightNowPostV3",
			id,
			profileId: id + 100,
			displayName,
			media: [],
			hosting: false,
			posted: 900,
			expiration,
			recentlyChatted: false,
			favorite: false,
		},
	};
}

beforeEach(() => {
	getRightNowFeedMock.mockReset();
	setNowForTesting(() => 1_000);
});

describe("getPosts", () => {
	it("maps supported posts while ignoring unknown, malformed, and expired items", async () => {
		getRightNowFeedMock.mockResolvedValue({
			items: [
				{ type: "future_post_v9", data: { id: 99 } },
				{ type: "right_now_post_v3", data: { id: "bad" } },
				item({ id: 1, expiration: 999 }),
				item({ id: 2 }),
			],
			viewerCount: 12,
		});

		const result = await getPosts({ sort: "DISTANCE" });

		expect(result.viewerCount).toBe(12);
		expect(result.posts).toEqual([
			expect.objectContaining({
				id: 2,
				displayName: "Profile 2",
				expiration: 2_000,
			}),
		]);
	});

	it("deduplicates posts by server id using the latest item", async () => {
		getRightNowFeedMock.mockResolvedValue({
			items: [
				item({ id: 1, displayName: "Old" }),
				item({ id: 1, displayName: "New" }),
			],
			viewerCount: 1,
		});

		const result = await getPosts({ sort: "NEWEST" });

		expect(result.posts).toHaveLength(1);
		expect(result.posts[0]!.displayName).toBe("New");
	});
});

afterEach(() => resetNowForTesting());
