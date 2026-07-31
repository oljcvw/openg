import { reportMediaOrigin } from "$lib/platform/media-origin-logging";
import type { AlbumContentResponse } from "$lib/api/messaging/albums";
import { albumMediaLoadError } from "./album-media-error";

export type AlbumImageDimensions = {
	src: string;
	width: number;
	height: number;
};

export type AlbumVideoDimensions = {
	width: number;
	height: number;
};

export type PreloadedAlbumSlide = AlbumContentResponse["content"][number] & {
	width: number;
	height: number;
};

export async function preloadAlbumSlides(
	content: AlbumContentResponse["content"],
): Promise<PreloadedAlbumSlide[]> {
	const displayable = content.filter(
		(slide) =>
			slide.url.length > 0 &&
			slide.processing !== true &&
			slide.rejectionId === null,
	);
	if (displayable.length === 0) {
		throw new Error("Album has no viewable media yet");
	}
	return await Promise.all(
		displayable.map(async (slide) => {
			if (slide.contentType.startsWith("video/")) {
				return { ...slide, ...(await preloadAlbumVideo(slide.url)) };
			}
			return { ...slide, ...(await preloadAlbumImage(slide.url)) };
		}),
	);
}

export function preloadAlbumImage(
	source: string,
): Promise<AlbumImageDimensions> {
	if (source.length === 0) return Promise.reject(albumMediaLoadError("image"));

	const image = document.createElement("img");
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			image.removeEventListener("load", onLoad);
			image.removeEventListener("error", onError);
			image.remove();
		};
		const onLoad = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "image", "loaded");
			cleanup();
			resolve({
				src: source,
				width: image.naturalWidth,
				height: image.naturalHeight,
			});
		};
		const onError = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "image", "failed");
			cleanup();
			reject(albumMediaLoadError("image"));
		};

		image.addEventListener("load", onLoad);
		image.addEventListener("error", onError);
		image.src = source;
		if (image.complete) {
			if (image.naturalWidth > 0) onLoad();
			else onError();
		}
	});
}

export function preloadAlbumVideo(
	source: string,
): Promise<AlbumVideoDimensions> {
	if (source.length === 0) return Promise.reject(albumMediaLoadError("video"));

	const video = document.createElement("video");
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			video.removeEventListener("loadedmetadata", onLoaded);
			video.removeEventListener("error", onError);
			video.remove();
		};
		const onLoaded = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "video", "loaded");
			cleanup();
			resolve({ width: video.videoWidth, height: video.videoHeight });
		};
		const onError = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "video", "failed");
			cleanup();
			reject(albumMediaLoadError("video"));
		};

		video.addEventListener("loadedmetadata", onLoaded);
		video.addEventListener("error", onError);
		video.src = source;
		video.load();
		if (video.readyState >= 1) onLoaded();
	});
}
