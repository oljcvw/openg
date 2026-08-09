import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationMediaViewerState } from "$lib/chat/conversation-media-viewer.svelte";
import Harness from "./ImageMessage.test-harness.svelte";

afterEach(cleanup);

describe("ImageMessage", () => {
	it("loads lazily and opens the conversation-level viewer", async () => {
		const viewer = new ConversationMediaViewerState();
		const view = render(Harness, {
			messageId: "image-message",
			message: {
				url: "https://example.test/image.jpg",
				imageHash: "hash",
				takenOnGrindr: false,
				createdAt: null,
				mediaId: 1,
				width: 640,
				height: 480,
			},
			viewer,
		});

		const image = view.getByRole("presentation");
		expect(image.getAttribute("loading")).toBe("lazy");
		expect(image.getAttribute("decoding")).toBe("async");

		await fireEvent.click(view.getByRole("button", { name: "Open image" }));
		expect(viewer.ownerCount).toBe(1);
		expect(viewer.activeMessageId).toBe("image-message");
		expect(viewer.items).toEqual([
			{
				id: "image-message",
				kind: "image",
				url: "https://example.test/image.jpg",
			},
		]);
	});
});
