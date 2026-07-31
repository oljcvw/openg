import { invoke } from "@tauri-apps/api/core";

type MediaElementKind = "image" | "video" | "audio";
type MediaLoadOutcome = "loaded" | "failed";
type MediaSurface =
	| "albums"
	| "browse"
	| "chat"
	| "profile"
	| "right_now"
	| "other";

const reported = new Set<string>();

export function networkMediaOrigin(source: string): string | null {
	try {
		const url = new URL(source, document.baseURI);
		return url.protocol === "https:" ? url.origin : null;
	} catch {
		return null;
	}
}

export function mediaSurface(pathname: string): MediaSurface {
	if (pathname === "/albums" || pathname.startsWith("/albums/"))
		return "albums";
	if (pathname === "/" || pathname.startsWith("/browse/")) return "browse";
	if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chat";
	if (pathname === "/profile" || pathname.startsWith("/profile/"))
		return "profile";
	if (pathname === "/right-now" || pathname.startsWith("/right-now/")) {
		return "right_now";
	}
	return "other";
}

function mediaElement(
	target: EventTarget | null,
): { kind: MediaElementKind; source: string } | null {
	if (target instanceof HTMLImageElement) {
		return { kind: "image", source: target.currentSrc || target.src };
	}
	if (target instanceof HTMLVideoElement) {
		return { kind: "video", source: target.currentSrc || target.src };
	}
	if (target instanceof HTMLAudioElement) {
		return { kind: "audio", source: target.currentSrc || target.src };
	}
	return null;
}

export function reportMediaOrigin(
	source: string,
	kind: MediaElementKind,
	outcome: MediaLoadOutcome,
): void {
	const origin = networkMediaOrigin(source);
	if (origin === null) return;
	const surface = mediaSurface(window.location.pathname);
	const key = `${origin}\n${kind}\n${outcome}\n${surface}`;
	if (reported.has(key)) return;
	reported.add(key);
	void invoke("report_media_origin", {
		observation: {
			origin,
			elementKind: kind,
			outcome,
			surface,
		},
	}).catch(() => {
		reported.delete(key);
		// Diagnostics must never affect media rendering.
	});
}

export function registerMediaOriginLogging(): () => void {
	const report = (outcome: MediaLoadOutcome) => (event: Event) => {
		const media = mediaElement(event.target);
		if (!media) return;
		reportMediaOrigin(media.source, media.kind, outcome);
	};

	const onLoad = report("loaded");
	const onError = report("failed");
	document.addEventListener("load", onLoad, true);
	document.addEventListener("loadeddata", onLoad, true);
	document.addEventListener("error", onError, true);
	return () => {
		document.removeEventListener("load", onLoad, true);
		document.removeEventListener("loadeddata", onLoad, true);
		document.removeEventListener("error", onError, true);
	};
}
