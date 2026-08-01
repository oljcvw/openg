import { describe, expect, it, vi } from "vitest";

import { activateMedia, releaseMedia } from "./media-playback";

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
});
