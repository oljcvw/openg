import z from "zod";

import { notificationEventSchema, ws } from "$lib/ws.svelte";

export const incomingVideoCallEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("videocall.v1.incoming_call"),
	payload: z.object({
		channelId: z.string().min(1),
		senderId: z.coerce.number().int().nonnegative(),
	}),
});

export const videoCallEndedEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("videocall.v1.call_ended"),
	payload: z.object({
		duration: z.coerce.number().int().nonnegative(),
		result: z.string().min(1),
		channelId: z.string().min(1),
	}),
});

export type IncomingVideoCall = z.infer<
	typeof incomingVideoCallEventSchema
>["payload"];
export type VideoCallEnded = z.infer<
	typeof videoCallEndedEventSchema
>["payload"];

export interface VideoCallEventSource {
	onIncoming(handler: (call: IncomingVideoCall) => void): Promise<() => void>;
	onEnded(handler: (call: VideoCallEnded) => void): Promise<() => void>;
}

export const videoCallEvents: VideoCallEventSource = {
	onIncoming(handler) {
		return ws.on(
			"videocall.v1.incoming_call",
			incomingVideoCallEventSchema,
			(event) => handler(event.payload),
		);
	},
	onEnded(handler) {
		return ws.on(
			"videocall.v1.call_ended",
			videoCallEndedEventSchema,
			(event) => handler(event.payload),
		);
	},
};
