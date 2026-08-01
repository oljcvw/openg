import { describe, expect, it } from "vitest";

import {
	apiResponseMessageSchema,
	applyMessageRetractions,
	messageSchema,
	previewFromMessage,
	previewLabel,
} from "$lib/model/messaging/messages";

describe("messageSchema", () => {
	it("accepts outgoing text messages", () => {
		expect(
			messageSchema.parse({
				type: "Text",
				body: {
					text: "hello",
				},
			}),
		).toEqual({
			type: "Text",
			body: {
				text: "hello",
			},
		});
	});

	it("rejects private image messages with invalid media hashes", () => {
		const result = messageSchema.safeParse({
			type: "Image",
			body: {
				mediaId: 10,
				url: "https://images.example/private.jpg",
				width: 640,
				height: 480,
				imageHash: "abc123",
				takenOnGrindr: false,
				createdAt: 1_710_000_000_000,
			},
		});

		expect(result.success).toBe(false);
	});

	it("accepts bounded location messages", () => {
		expect(
			messageSchema.parse({
				type: "Location",
				body: { lat: 53.35, lon: -6.26 },
			}),
		).toEqual({ type: "Location", body: { lat: 53.35, lon: -6.26 } });
		expect(
			messageSchema.safeParse({
				type: "Location",
				body: { lat: 91, lon: 0 },
			}).success,
		).toBe(false);
	});
});

describe("apiResponseMessageSchema", () => {
	it("accepts incoming chat messages with response metadata", () => {
		expect(
			apiResponseMessageSchema.parse({
				type: "Text",
				body: {
					text: "hello",
				},
				messageId: "msg-1",
				conversationId: "conversation-1",
				senderId: 42,
				timestamp: 1_710_000_000_000,
				unsent: false,
				reactions: [
					{
						profileId: 99,
						reactionType: 1,
					},
				],
			}),
		).toEqual({
			type: "Text",
			body: {
				text: "hello",
			},
			messageId: "msg-1",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			unsent: false,
			reactions: [
				{
					profileId: 99,
					reactionType: 1,
				},
			],
		});
	});

	it("degrades a malformed known body without rejecting message metadata", () => {
		const message = apiResponseMessageSchema.parse({
			type: "Audio",
			body: { mediaId: "not-a-number" },
			messageId: "msg-2",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			unsent: false,
			reactions: [],
		});
		expect(message.type).toBe("Unknown");
		expect(message.body).toEqual({ sourceType: "Audio" });
	});
});

describe("applyMessageRetractions", () => {
	const target = apiResponseMessageSchema.parse({
		type: "Text",
		body: { text: "keep me private" },
		messageId: "target",
		conversationId: "conversation-1",
		senderId: 42,
		timestamp: 1_710_000_000_000,
		unsent: false,
		reactions: [],
	});
	const retract = apiResponseMessageSchema.parse({
		type: "Retract",
		body: { targetMessageId: "target" },
		messageId: "retract",
		conversationId: "conversation-1",
		senderId: 42,
		timestamp: 1_710_000_000_001,
		unsent: false,
		reactions: [],
	});

	it("replaces loaded targets by default", () => {
		expect(applyMessageRetractions([retract, target], false)).toMatchObject([
			{ messageId: "target", type: "Retracted", body: null },
		]);
	});

	it("keeps loaded targets when opted in", () => {
		expect(applyMessageRetractions([retract, target], true)).toEqual([target]);
	});

	it("deduplicates missing-target retract events", () => {
		const duplicate = { ...retract, messageId: "retract-2" };
		expect(applyMessageRetractions([retract, duplicate], false)).toHaveLength(
			1,
		);
	});
});

describe("previewFromMessage", () => {
	it("labels location previews", () => {
		const preview = previewFromMessage({
			type: "Location",
			body: { lat: 53.35, lon: -6.26 },
			messageId: "location-1",
			conversationId: "conversation-1",
			senderId: 42,
			timestamp: 1_710_000_000_000,
			unsent: false,
			reactions: [],
		});
		expect(preview.type).toBe("Location");
		expect(previewLabel(preview)).toBe("Location");
	});

	it("extracts preview text from text messages", () => {
		expect(
			previewFromMessage({
				type: "Text",
				body: { text: "hello" },
				messageId: "msg-1",
				conversationId: "conversation-1",
				senderId: 42,
				timestamp: 1_710_000_000_000,
				unsent: false,
				reactions: [],
			}),
		).toEqual({
			type: "Text",
			text: "hello",
			albumId: null,
			imageHash: null,
		});
	});

	it("extracts album previews without inventing text", () => {
		expect(
			previewFromMessage({
				type: "Album",
				body: {
					albumId: 7,
					hasUnseenContent: false,
					expiresAt: null,
					coverUrl: "https://example.com/cover.jpg",
					ownerProfileId: 42,
					isViewable: true,
					hasVideo: false,
					hasPhoto: true,
					expirationType: null,
				},
				messageId: "msg-2",
				conversationId: "conversation-1",
				senderId: 42,
				timestamp: 1_710_000_000_000,
				unsent: false,
				reactions: [],
			}),
		).toEqual({
			type: "Album",
			text: null,
			albumId: 7,
			imageHash: null,
		});
	});

	it.each(["ExpiringAlbum", "ExpiringAlbumV2"] as const)(
		"keeps the albumId for %s so the preview reads as an album",
		(type) => {
			const preview = previewFromMessage({
				type,
				body: {
					albumId: 9,
					hasUnseenContent: false,
					expiresAt: 1_710_000_000_000,
					coverUrl: "https://example.com/cover.jpg",
					ownerProfileId: 42,
					isViewable: true,
					hasVideo: false,
					hasPhoto: true,
					expirationType: "ONCE",
					viewableUntil: 1_710_000_000_000,
				},
				messageId: "msg-3",
				conversationId: "conversation-1",
				senderId: 42,
				timestamp: 1_710_000_000_000,
				unsent: false,
				reactions: [],
			});
			expect(preview).toEqual({
				type,
				text: null,
				albumId: 9,
				imageHash: null,
			});
			expect(previewLabel(preview)).toBe("Album");
		},
	);
});
