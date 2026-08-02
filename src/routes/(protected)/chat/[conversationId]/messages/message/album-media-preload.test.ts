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
		contentId: number;
		contentType: string;
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

	it("bounds concurrent media inspection and preserves slide order", async () => {
		const images = Array.from({ length: 4 }, () => {
			const image = createElement("img");
			Object.defineProperties(image, {
				complete: { configurable: true, value: false },
				naturalHeight: { configurable: true, value: 480 },
				naturalWidth: { configurable: true, value: 640 },
			});
			return image;
		});
		let created = 0;
		vi.spyOn(document, "createElement").mockImplementation(
			(name: string, options?: ElementCreationOptions) => {
				if (name === "img") return images[created++];
				return createElement(name, options);
			},
		);

		const pending = preloadAlbumSlides(
			images.map((_, index) =>
				albumSlide({
					contentId: index + 1,
					url: `https://d-album-concurrency.cloudfront.net/${index + 1}`,
				}),
			),
			{ concurrency: 2 },
		);
		expect(created).toBe(2);

		images[1].dispatchEvent(new Event("load"));
		await vi.waitFor(() => expect(created).toBe(3));
		images[0].dispatchEvent(new Event("load"));
		await vi.waitFor(() => expect(created).toBe(4));
		images[2].dispatchEvent(new Event("load"));
		images[3].dispatchEvent(new Event("load"));

		await expect(pending).resolves.toEqual(
			[1, 2, 3, 4].map((contentId) =>
				expect.objectContaining({ contentId, width: 640, height: 480 }),
			),
		);
	});

	it("cancels in-flight media inspection", async () => {
		const image = createElement("img");
		const removeSource = vi.spyOn(image, "removeAttribute");
		const removeElement = vi.spyOn(image, "remove");
		Object.defineProperty(image, "complete", {
			configurable: true,
			value: false,
		});
		returnElementFor("img", image);
		const controller = new AbortController();

		const pending = preloadAlbumSlides([albumSlide()], {
			concurrency: 1,
			signal: controller.signal,
		});
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(removeSource).toHaveBeenCalledWith("src");
		expect(removeElement).toHaveBeenCalledOnce();
	});

	it("cancels sibling media inspection after the first failure", async () => {
		const images = [createElement("img"), createElement("img")];
		for (const image of images) {
			Object.defineProperty(image, "complete", {
				configurable: true,
				value: false,
			});
		}
		const siblingRemoveSource = vi.spyOn(images[1], "removeAttribute");
		let created = 0;
		vi.spyOn(document, "createElement").mockImplementation(
			(name: string, options?: ElementCreationOptions) => {
				if (name === "img") return images[created++];
				return createElement(name, options);
			},
		);

		const pending = preloadAlbumSlides(
			[albumSlide({ contentId: 1 }), albumSlide({ contentId: 2 })],
			{ concurrency: 2 },
		);
		images[0].dispatchEvent(new Event("error"));

		await expect(pending).rejects.toThrow("Failed to load album image");
		expect(siblingRemoveSource).toHaveBeenCalledWith("src");
	});

	it("stops and unloads an aborted detached video", async () => {
		const video = createElement("video");
		const pause = vi.fn();
		const load = vi.fn();
		const removeSource = vi.spyOn(video, "removeAttribute");
		Object.defineProperties(video, {
			load: { configurable: true, value: load },
			pause: { configurable: true, value: pause },
			readyState: { configurable: true, value: 0 },
		});
		returnElementFor("video", video);
		const controller = new AbortController();

		const pending = preloadAlbumVideo(
			"https://d-album-video.cloudfront.net/private/id",
			controller.signal,
		);
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(pause).toHaveBeenCalledOnce();
		expect(removeSource).toHaveBeenCalledWith("src");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("reports a successful detached image preload without private URL data", async () => {
		const image = createElement("img");
		vi.spyOn(image, "removeAttribute").mockImplementation(() => {
			Object.defineProperties(image, {
				naturalHeight: { configurable: true, value: 0 },
				naturalWidth: { configurable: true, value: 0 },
			});
		});
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
		const load = vi.fn(() => {
			if (load.mock.calls.length < 2) return;
			Object.defineProperties(loadedVideo, {
				videoHeight: { configurable: true, value: 0 },
				videoWidth: { configurable: true, value: 0 },
			});
		});
		Object.defineProperties(loadedVideo, {
			load: { configurable: true, value: load },
			pause: { configurable: true, value: vi.fn() },
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
			pause: { configurable: true, value: vi.fn() },
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
