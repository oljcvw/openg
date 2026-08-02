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
	options: { concurrency?: number; signal?: AbortSignal } = {},
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
	const concurrency = Math.max(
		1,
		Math.min(displayable.length, Math.floor(options.concurrency ?? 3)),
	);
	const results = new Array<PreloadedAlbumSlide>(displayable.length);
	let nextIndex = 0;
	const workerAbortController = new AbortController();
	const onExternalAbort = () => workerAbortController.abort();
	if (options.signal?.aborted) workerAbortController.abort();
	else
		options.signal?.addEventListener("abort", onExternalAbort, { once: true });
	const worker = async () => {
		while (nextIndex < displayable.length) {
			if (workerAbortController.signal.aborted) throw abortError();
			const index = nextIndex++;
			const slide = displayable[index];
			if (slide.contentType.startsWith("video/")) {
				results[index] = {
					...slide,
					...(await preloadAlbumVideo(slide.url, workerAbortController.signal)),
				};
				continue;
			}
			results[index] = {
				...slide,
				...(await preloadAlbumImage(slide.url, workerAbortController.signal)),
			};
		}
	};
	const workers = Array.from({ length: concurrency }, () => worker());
	try {
		await Promise.all(workers);
		return results;
	} catch (error) {
		workerAbortController.abort();
		await Promise.allSettled(workers);
		throw error;
	} finally {
		options.signal?.removeEventListener("abort", onExternalAbort);
	}
}

export function preloadAlbumImage(
	source: string,
	signal?: AbortSignal,
): Promise<AlbumImageDimensions> {
	if (source.length === 0) return Promise.reject(albumMediaLoadError("image"));
	if (signal?.aborted) return Promise.reject(abortError());

	const image = document.createElement("img");
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			image.removeEventListener("load", onLoad);
			image.removeEventListener("error", onError);
			image.removeAttribute("src");
			image.remove();
			signal?.removeEventListener("abort", onAbort);
		};
		const onLoad = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "image", "loaded");
			const dimensions = {
				src: source,
				width: image.naturalWidth,
				height: image.naturalHeight,
			};
			cleanup();
			resolve(dimensions);
		};
		const onError = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "image", "failed");
			cleanup();
			reject(albumMediaLoadError("image"));
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(abortError());
		};

		image.addEventListener("load", onLoad);
		image.addEventListener("error", onError);
		signal?.addEventListener("abort", onAbort, { once: true });
		image.src = source;
		if (image.complete) {
			if (image.naturalWidth > 0) onLoad();
			else onError();
		}
	});
}

export function preloadAlbumVideo(
	source: string,
	signal?: AbortSignal,
): Promise<AlbumVideoDimensions> {
	if (source.length === 0) return Promise.reject(albumMediaLoadError("video"));
	if (signal?.aborted) return Promise.reject(abortError());

	const video = document.createElement("video");
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			video.removeEventListener("loadedmetadata", onLoaded);
			video.removeEventListener("error", onError);
			video.pause();
			video.removeAttribute("src");
			video.load();
			video.remove();
			signal?.removeEventListener("abort", onAbort);
		};
		const onLoaded = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "video", "loaded");
			const dimensions = {
				width: video.videoWidth,
				height: video.videoHeight,
			};
			cleanup();
			resolve(dimensions);
		};
		const onError = () => {
			if (settled) return;
			settled = true;
			reportMediaOrigin(source, "video", "failed");
			cleanup();
			reject(albumMediaLoadError("video"));
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(abortError());
		};

		video.addEventListener("loadedmetadata", onLoaded);
		video.addEventListener("error", onError);
		signal?.addEventListener("abort", onAbort, { once: true });
		video.src = source;
		video.load();
		if (video.readyState >= 1) onLoaded();
	});
}

function abortError(): DOMException {
	return new DOMException("Album preload cancelled", "AbortError");
}
