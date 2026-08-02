import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/ws.svelte", async () => {
	const { default: z } = await import("zod");
	return {
		notificationEventSchema: z.object({
			type: z.string(),
			notificationId: z.string().nullable(),
			ref: z.string().nullable(),
			payload: z.unknown(),
		}),
		ws: { on: vi.fn() },
	};
});

import {
	incomingVideoCallEventSchema,
	videoCallEndedEventSchema,
} from "$lib/video-call/events";

const notification = {
	notificationId: null,
	ref: null,
};

describe("video-call websocket contracts", () => {
	it("parses an incoming call and coerces sender IDs", () => {
		const event = incomingVideoCallEventSchema.parse({
			...notification,
			type: "videocall.v1.incoming_call",
			payload: { channelId: "channel", senderId: "42" },
		});

		expect(event.payload).toEqual({ channelId: "channel", senderId: 42 });
	});

	it("parses server call completion details", () => {
		const event = videoCallEndedEventSchema.parse({
			...notification,
			type: "videocall.v1.call_ended",
			payload: { channelId: "channel", duration: 19, result: "SUCCESSFUL" },
		});

		expect(event.payload).toEqual({
			channelId: "channel",
			duration: 19,
			result: "SUCCESSFUL",
		});
	});

	it("rejects incomplete incoming calls", () => {
		expect(
			incomingVideoCallEventSchema.safeParse({
				...notification,
				type: "videocall.v1.incoming_call",
				payload: { senderId: 42 },
			}).success,
		).toBe(false);
	});
});
