import { describe, expect, it } from "vitest";

import type { PickedMedia } from "$lib/platform/media-picker";
import { selectAlbumMedia } from "./+page.svelte";

function media(key: string, mimeType: string): PickedMedia {
	return {
		source: "desktop",
		key,
		mimeType,
		path: `/tmp/${key}`,
	};
}

describe("album media selection", () => {
	it("allows one new video alongside photos", () => {
		const photoOne = media("photo-one", "image/jpeg");
		const videoOne = media("video-one", "video/mp4");
		const videoTwo = media("video-two", "video/webm");
		const photoTwo = media("photo-two", "image/png");

		expect(
			selectAlbumMedia({
				existingContentTypes: ["image/jpeg"],
				picked: [photoOne, videoOne, videoTwo, photoTwo],
				remaining: 4,
			}),
		).toEqual({
			selected: [photoOne, videoOne, photoTwo],
			skippedForCapacity: 0,
			skippedVideos: 1,
		});
	});

	it("rejects new videos when album already contains one without rejecting photos", () => {
		const video = media("video", "video/mp4");
		const photo = media("photo", "image/jpeg");

		expect(
			selectAlbumMedia({
				existingContentTypes: ["video/mp4"],
				picked: [video, photo],
				remaining: 2,
			}),
		).toEqual({
			selected: [photo],
			skippedForCapacity: 0,
			skippedVideos: 1,
		});
	});

	it("applies album capacity after removing disallowed videos", () => {
		const video = media("video", "video/mp4");
		const photoOne = media("photo-one", "image/jpeg");
		const photoTwo = media("photo-two", "image/png");

		expect(
			selectAlbumMedia({
				existingContentTypes: ["video/webm"],
				picked: [video, photoOne, photoTwo],
				remaining: 1,
			}),
		).toEqual({
			selected: [photoOne],
			skippedForCapacity: 1,
			skippedVideos: 1,
		});
	});
});
