import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationMediaViewerState } from "$lib/chat/conversation-media-viewer.svelte";
import { apiResponseMessageSchema } from "$lib/model/messaging/messages";
import type {
	ApiResponseMessage,
	ImageMessage as ImageMessageModel,
} from "$lib/model/messaging/messages";
import Harness from "./ImageMessage.test-harness.svelte";

afterEach(cleanup);

describe("ImageMessage", () => {
	function image(
		messageId: string,
		timestamp: number,
		senderId = 42,
	): ApiResponseMessage & { type: "Image"; body: ImageMessageModel["body"] } {
		return apiResponseMessageSchema.parse({
			type: "Image",
			body: {
				mediaId: timestamp,
				url: `https://example.test/${messageId}.jpg`,
				imageHash: "a".repeat(64),
				takenOnGrindr: false,
				createdAt: null,
				width: 640,
				height: 480,
			},
			messageId,
			conversationId: "conversation-42",
			senderId,
			timestamp,
			unsent: false,
			reactions: [],
		}) as ApiResponseMessage & {
			type: "Image";
			body: ImageMessageModel["body"];
		};
	}
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
				width: 640,
				height: 480,
			},
		]);
	});

	it("opens received ordinary media in oldest-to-newest transcript order", async () => {
		const viewer = new ConversationMediaViewerState();
		const current = image("current", 200);
		const view = render(Harness, {
			messageId: current.messageId,
			message: current.body,
			viewer,
			receivedFromPeer: true,
			conversationMessages: [
				image("newer", 300),
				current,
				image("older", 100),
				image("sent", 50, 7),
			],
		});

		await fireEvent.click(view.getByRole("button", { name: "Open image" }));
		expect(viewer.items.map((item) => item.id)).toEqual([
			"older",
			"current",
			"newer",
		]);
		expect(viewer.startIndex).toBe(1);
	});
});
