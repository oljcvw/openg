import { describe, expect, it } from "vitest";

import {
	classifyReceivedSharedMedia,
	galleryPlayableUrl,
	isReceivedFromConversationPeer,
} from "$lib/chat/shared-media";
import { apiResponseMessageSchema } from "$lib/model/messaging/messages";

const context = {
	accountProfileId: 7,
	conversationId: "conversation-42",
	peerProfileId: 42,
};

function response(
	type: string,
	body: unknown,
	overrides: Record<string, unknown> = {},
) {
	return apiResponseMessageSchema.parse({
		type,
		body,
		messageId: `message-${type}`,
		conversationId: context.conversationId,
		senderId: context.peerProfileId,
		timestamp: 1_710_000_000_000,
		unsent: false,
		reactions: [],
		...overrides,
	});
}

describe("received shared-media classification", () => {
	it("requires an incoming message from the active conversation peer", () => {
		const identity = {
			accountProfileId: 7,
			peerProfileId: 42,
			senderProfileId: 42,
			isOut: false,
		};
		expect(isReceivedFromConversationPeer(identity)).toBe(true);
		expect(isReceivedFromConversationPeer({ ...identity, isOut: true })).toBe(
			false,
		);
		expect(
			isReceivedFromConversationPeer({ ...identity, senderProfileId: 99 }),
		).toBe(false);
		expect(
			isReceivedFromConversationPeer({ ...identity, peerProfileId: 7 }),
		).toBe(false);
	});
	it("never exposes an uncached consumptive URL to gallery media elements", () => {
		expect(
			galleryPlayableUrl(
				{ consumptive: true, remoteUrl: "https://signed.example/view-once" },
				null,
			),
		).toBeNull();
		expect(
			galleryPlayableUrl(
				{ consumptive: true, remoteUrl: "https://signed.example/view-once" },
				"direct-media://opaque",
			),
		).toBe("direct-media://opaque");
	});
	it("classifies received direct images and videos with message identity", () => {
		const image = response("Image", {
			mediaId: 11,
			url: "https://images.example/image.jpg",
			width: 640,
			height: 480,
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: null,
		});
		const video = response("PrivateVideo", {
			mediaId: 12,
			url: "https://images.example/video.mp4",
			contentType: "video/mp4",
			length: 1_000,
			maxViews: 1,
			looping: false,
			viewsRemaining: 0,
			viewCount: 1,
		});

		expect(classifyReceivedSharedMedia(image, context)).toMatchObject({
			messageId: "message-Image",
			mediaId: "11",
			kind: "image",
			remoteAvailability: "available",
		});
		expect(classifyReceivedSharedMedia(video, context)).toMatchObject({
			messageId: "message-PrivateVideo",
			mediaId: "12",
			kind: "video",
			remoteAvailability: "views_exhausted",
		});
	});

	it("never classifies albums, outgoing media, other conversations, or unsent media", () => {
		const imageBody = {
			mediaId: 11,
			url: "https://images.example/image.jpg",
			width: 640,
			height: 480,
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: null,
		};
		const album = response("Album", {
			albumId: 9,
			hasUnseenContent: false,
			expiresAt: null,
			coverUrl: null,
			ownerProfileId: 42,
			isViewable: true,
			hasVideo: false,
			hasPhoto: true,
		});

		expect(classifyReceivedSharedMedia(album, context)).toBeNull();
		expect(
			classifyReceivedSharedMedia(
				response("Image", imageBody, { senderId: context.accountProfileId }),
				context,
			),
		).toBeNull();
		expect(
			classifyReceivedSharedMedia(
				response("Image", imageBody, { conversationId: "other" }),
				context,
			),
		).toBeNull();
		expect(
			classifyReceivedSharedMedia(
				response("Image", null, { unsent: true }),
				context,
			),
		).toBeNull();
	});

	it("does not treat a locked expiring tile as remotely available", () => {
		const image = response("ExpiringImage", {
			mediaId: 13,
			width: 640,
			height: 480,
			url: null,
			viewsRemaining: 0,
		});

		expect(classifyReceivedSharedMedia(image, context)).toMatchObject({
			remoteAvailability: "views_exhausted",
			cacheAvailability: "not_cached",
		});
	});
});
