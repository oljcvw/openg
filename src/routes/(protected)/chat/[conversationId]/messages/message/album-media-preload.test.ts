import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
}));

import {
	preloadAlbumImage,
	preloadAlbumSlides,
	preloadAlbumVideo,
} from "./album-media-preload";

const createElement = document.createElement.bind(document);

function returnElementFor(
	tag: "img" | "video",
	element: HTMLImageElement | HTMLVideoElement,
) {
	return vi
		.spyOn(document, "createElement")
		.mockImplementation((name: string, options?: ElementCreationOptions) => {
			if (name === tag) return element;
			return createElement(name, options);
		});
}

function albumSlide(
	overrides: Partial<{
		processing: boolean | null;
		rejectionId: unknown;
		url: string;
	}> = {},
) {
	return {
		contentId: 1,
		contentType: "image/jpeg",
		coverUrl: null,
		processing: null,
		rejectionId: null,
		statusId: 1,
		thumbUrl: "https://d-album-processing.cloudfront.net/thumb",
		url: "https://d-album-processing.cloudfront.net/private/id",
		...overrides,
	};
}

beforeEach(() => {
	invokeMock.mockReset();
	invokeMock.mockResolvedValue();
	window.history.replaceState({}, "", "/chat/private-conversation-id");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("detached album media preload diagnostics", () => {
	it("rejects albums with no displayable content", async () => {
		await expect(preloadAlbumSlides([])).rejects.toThrow();
		await expect(
			preloadAlbumSlides([albumSlide({ processing: true })]),
		).rejects.toThrow();
		await expect(
			preloadAlbumSlides([albumSlide({ rejectionId: "rejected" })]),
		).rejects.toThrow();
		await expect(
			preloadAlbumSlides([albumSlide({ url: "" })]),
		).rejects.toThrow();
	});

	it("keeps a processing-only album retryable", async () => {
		const image = createElement("img");
		Object.defineProperties(image, {
			complete: { configurable: true, value: true },
			naturalHeight: { configurable: true, value: 480 },
			naturalWidth: { configurable: true, value: 640 },
		});
		returnElementFor("img", image);

		await expect(
			preloadAlbumSlides([albumSlide({ processing: true })]),
		).rejects.toThrow();
		await expect(preloadAlbumSlides([albumSlide()])).resolves.toEqual([
			expect.objectContaining({
				contentId: 1,
				width: 640,
				height: 480,
			}),
		]);
	});

	it("reports a successful detached image preload without private URL data", async () => {
		const image = createElement("img");
		Object.defineProperties(image, {
			complete: { configurable: true, value: false },
			naturalHeight: { configurable: true, value: 480 },
			naturalWidth: { configurable: true, value: 640 },
		});
		returnElementFor("img", image);

		const result = preloadAlbumImage(
			"https://d-album-image.cloudfront.net/private/id?Signature=secret",
		);
		image.dispatchEvent(new Event("load"));

		await expect(result).resolves.toEqual({
			src: "https://d-album-image.cloudfront.net/private/id?Signature=secret",
			width: 640,
			height: 480,
		});
		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-album-image.cloudfront.net",
				elementKind: "image",
				outcome: "loaded",
				surface: "chat",
			},
		});
	});

	it("reports a failed detached image preload without exposing its URL", async () => {
		const image = createElement("img");
		Object.defineProperty(image, "complete", {
			configurable: true,
			value: false,
		});
		returnElementFor("img", image);

		const result = preloadAlbumImage(
			"https://d-album-image-fail.cloudfront.net/private/id?Policy=secret",
		);
		image.dispatchEvent(new Event("error"));

		await expect(result).rejects.toThrow("Failed to load album image");
		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-album-image-fail.cloudfront.net",
				elementKind: "image",
				outcome: "failed",
				surface: "chat",
			},
		});
		expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("Policy");
	});

	it("reports successful and failed detached video preloads", async () => {
		const loadedVideo = createElement("video");
		Object.defineProperties(loadedVideo, {
			load: { configurable: true, value: vi.fn() },
			readyState: { configurable: true, value: 0 },
			videoHeight: { configurable: true, value: 720 },
			videoWidth: { configurable: true, value: 1280 },
		});
		returnElementFor("video", loadedVideo);

		const loaded = preloadAlbumVideo(
			"https://d-album-video.cloudfront.net/private/id?Signature=secret",
		);
		loadedVideo.dispatchEvent(new Event("loadedmetadata"));
		await expect(loaded).resolves.toEqual({ width: 1280, height: 720 });

		vi.restoreAllMocks();
		const failedVideo = createElement("video");
		Object.defineProperties(failedVideo, {
			load: { configurable: true, value: vi.fn() },
			readyState: { configurable: true, value: 0 },
		});
		returnElementFor("video", failedVideo);
		const failed = preloadAlbumVideo(
			"https://d-album-video-fail.cloudfront.net/private/id?Policy=secret",
		);
		failedVideo.dispatchEvent(new Event("error"));
		await expect(failed).rejects.toThrow("Failed to load album video");

		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-album-video.cloudfront.net",
				elementKind: "video",
				outcome: "loaded",
				surface: "chat",
			},
		});
		expect(invokeMock).toHaveBeenCalledWith("report_media_origin", {
			observation: {
				origin: "https://d-album-video-fail.cloudfront.net",
				elementKind: "video",
				outcome: "failed",
				surface: "chat",
			},
		});
	});
});
