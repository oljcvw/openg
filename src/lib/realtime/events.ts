import z from "zod";

export const realtimeEventSchema = z
	.object({
		type: z.string().min(1),
	})
	.passthrough();

export const realtimeCommandResponseSchema = realtimeEventSchema.extend({
	ref: z.string().min(1),
	status: z.number().int(),
	payload: z.unknown(),
});

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type RealtimeCommandResponse = z.infer<
	typeof realtimeCommandResponseSchema
>;

export function parseRealtimeEvent(message: string | unknown): RealtimeEvent {
	const data = typeof message === "string" ? JSON.parse(message) : message;
	return realtimeEventSchema.parse(data);
}

export function parseRealtimeCommandResponse(
	event: RealtimeEvent,
): RealtimeCommandResponse {
	return realtimeCommandResponseSchema.parse(event);
}

export function isRealtimeCommandResponse(event: RealtimeEvent) {
	return event.type.endsWith(".response") && "ref" in event;
}
