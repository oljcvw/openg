import { describe, expect, it, vi } from "vitest";

import { activateMedia, disposeMedia, releaseMedia } from "./media-playback";

describe("chat media playback coordination", () => {
	it("pauses the previous media element", () => {
		const first = document.createElement("audio");
		const second = document.createElement("video");
		const pause = vi.fn();
		Object.defineProperty(first, "pause", { value: pause });

		activateMedia(first);
		activateMedia(second);

		expect(pause).toHaveBeenCalledOnce();
		releaseMedia(second);
	});

	it("pauses and clears a disposable media source", () => {
		const element = document.createElement("video");
		const pause = vi.fn();
		const load = vi.fn();
		Object.defineProperties(element, {
			pause: { value: pause },
			load: { value: load },
		});
		element.src = "https://example.test/video.mp4";
		activateMedia(element);

		disposeMedia(element);

		expect(pause).toHaveBeenCalledOnce();
		expect(element.hasAttribute("src")).toBe(false);
		expect(load).toHaveBeenCalledOnce();
	});
});
