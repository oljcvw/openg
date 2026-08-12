import z from "zod";

import { fetchRest } from "$lib/api";

export const videoCallResultSchema = z.enum([
	"Success",
	"Error",
	"ExceededLengthLimit",
	"TargetProfileUnavailable",
]);

export type VideoCallResult = z.infer<typeof videoCallResultSchema>;

const optionalSecondsSchema = z.coerce.number().int().nonnegative().nullish();
const optionalStringSchema = z.string().min(1).nullish();

const videoCallInfoResponseSchema = z.object({
	remainingSeconds: z.coerce.number().int().nonnegative(),
});

const createVideoCallResponseSchema = z.object({
	result: videoCallResultSchema.nullish(),
	maxSeconds: optionalSecondsSchema,
	channelId: optionalStringSchema,
	remainingSeconds: optionalSecondsSchema,
	refreshSeconds: z.coerce.number().int().nonnegative().default(0),
	channel: optionalStringSchema,
	token: optionalStringSchema,
	message: z.string().nullish(),
});

const joinVideoCallResponseSchema = z.object({
	result: videoCallResultSchema.nullish(),
	token: optionalStringSchema,
	message: z.string().nullish(),
	channelId: optionalStringSchema,
	channel: optionalStringSchema,
	refreshSeconds: z.coerce.number().int().nonnegative().default(0),
});

const renewVideoCallResponseSchema = z.object({
	result: videoCallResultSchema.nullish(),
	token: optionalStringSchema,
	remainingSeconds: z.coerce.number().int().nonnegative(),
	refreshSeconds: z.coerce.number().int().nonnegative().default(0),
	message: z.string().nullish(),
});

export type VideoCallSession = {
	result: VideoCallResult;
	channelId: string | null;
	token: string | null;
	remainingSeconds: number;
	refreshSeconds: number;
	message: string | null;
};

export type VideoCallRenewal = Omit<VideoCallSession, "channelId">;

function normalizeResult(result: VideoCallResult | null | undefined) {
	return result ?? "Error";
}

export async function getVideoCallInfo(): Promise<{
	remainingSeconds: number;
}> {
	const response = await fetchRest("/v3/video-call");
	response.assertOk();
	return response.jsonParsed(videoCallInfoResponseSchema);
}

export async function createVideoCall({
	targetProfileId,
}: {
	targetProfileId: number;
}): Promise<VideoCallSession> {
	const response = await fetchRest("/v1/video-call", {
		method: "POST",
		body: { targetProfileId },
	});
	response.assertOk();
	const parsed = response.jsonParsed(createVideoCallResponseSchema);
	return {
		result: normalizeResult(parsed.result),
		channelId: parsed.channel ?? parsed.channelId ?? null,
		token: parsed.token ?? null,
		remainingSeconds: parsed.remainingSeconds ?? parsed.maxSeconds ?? 0,
		refreshSeconds: parsed.refreshSeconds,
		message: parsed.message ?? null,
	};
}

export async function joinVideoCall({
	channelId,
	remainingSeconds,
}: {
	channelId: string;
	remainingSeconds: number;
}): Promise<VideoCallSession> {
	const response = await fetchRest("/v1/video-call/join", {
		method: "PATCH",
		body: { channelId },
	});
	response.assertOk();
	const parsed = response.jsonParsed(joinVideoCallResponseSchema);
	return {
		result: normalizeResult(parsed.result),
		channelId: parsed.channel ?? parsed.channelId ?? channelId,
		token: parsed.token ?? null,
		remainingSeconds,
		refreshSeconds: parsed.refreshSeconds,
		message: parsed.message ?? null,
	};
}

export async function leaveVideoCall(channelId: string): Promise<void> {
	const response = await fetchRest("/v1/video-call/leave", {
		method: "PATCH",
		body: { channelId },
	});
	response.assertOk();
}

export async function renewVideoCall(): Promise<VideoCallRenewal> {
	const response = await fetchRest("/v1/video-call", { method: "PATCH" });
	response.assertOk();
	const parsed = response.jsonParsed(renewVideoCallResponseSchema);
	return {
		result: normalizeResult(parsed.result),
		token: parsed.token ?? null,
		remainingSeconds: parsed.remainingSeconds,
		refreshSeconds: parsed.refreshSeconds,
		message: parsed.message ?? null,
	};
}
