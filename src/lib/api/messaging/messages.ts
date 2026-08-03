import z from "zod";

import { fetchRest } from "$lib/api";
import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
	messageSchema,
} from "$lib/model/messaging/messages";
import { unixTimestampMsSchema } from "$lib/model/types";
import { ws } from "$lib/ws.svelte";
import type { Conversation } from "$lib/model/messaging/conversations";

const conversationMessagesSchema = z.object({
	lastReadTimestamp: unixTimestampMsSchema.nullable(),
	messages: z.array(apiResponseMessageSchema),
	profile: z.object({
		distance: z.number().nullable(),
		mediaHash: z.string().nullable(),
		name: z.string().nullable(),
		onlineUntil: z.number().nullable(),
		profileId: z.int(),
		showDistance: z.boolean(),
	}),
});

export async function getConversationMessages({
	abortController,
	conversationId,
	pageKey,
}: {
	abortController?: AbortController;
	conversationId: string;
	pageKey?: string;
}) {
	const params = new URLSearchParams({ profile: "true" });
	if (pageKey !== undefined) params.set("pageKey", pageKey);
	const messages = await fetchRest(
		`/v5/chat/conversation/${conversationId}/message?` + params.toString(),
		{ method: "GET", abortController },
	).then((res) => res.jsonParsed(conversationMessagesSchema));
	return messages;
}

export async function getSingleMessage({
	conversationId,
	messageId,
}: {
	conversationId: string;
	messageId: string;
}) {
	const message = await fetchRest(
		`/v4/chat/conversation/${conversationId}/message/${messageId}`,
		{ method: "GET" },
	).then((res) =>
		res.jsonParsed(z.object({ message: apiResponseMessageSchema })),
	);
	return message;
}

export function toOutboundBody(
	message: z.infer<typeof messageSchema>,
): unknown {
	if (message.type === "Image" || message.type === "Audio") {
		return { mediaId: message.body.mediaId };
	}
	return message.body;
}

export async function sendMessage({
	toUserId,
	message,
}: {
	toUserId: number;
	message: z.infer<typeof messageSchema>;
}) {
	return await fetchRest("/v4/chat/message/send", {
		method: "POST",
		body: {
			type: message.type,
			target: {
				type: "Direct",
				targetId: toUserId,
			},
			body: toOutboundBody(message),
		},
	}).then((res) => res.jsonParsed(apiResponseMessageSchema));
}

export async function sendReplyMessage({
	toUserId,
	message,
	replyToMessageId,
}: {
	toUserId: number;
	message: z.infer<typeof messageSchema>;
	replyToMessageId: string;
}) {
	const ref = crypto.randomUUID();
	return await ws.request(
		"chat.v1.message.send",
		{
			type: message.type,
			target: {
				type: "Direct",
				targetId: toUserId,
			},
			body: toOutboundBody(message),
			ref,
			replyToMessageId,
		},
		apiResponseMessageSchema,
	);
}

export function sendExpiringVideoMessage({
	toUserId,
	mediaId,
	looping,
	maxViews,
}: {
	toUserId: number;
	mediaId: number;
	looping: boolean;
	maxViews: 1 | 2;
}): void {
	ws.send("chat.v1.message.send", {
		type: "Video",
		target: {
			type: "Direct",
			targetId: toUserId,
		},
		body: { mediaId, looping, maxViews },
	});
}

export async function reactToMessage({
	conversationId,
	messageId,
	reactionType,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
	reactionType: number;
}) {
	return await fetchRest("/v4/chat/message/reaction", {
		method: "POST",
		body: {
			conversationId,
			messageId,
			reactionType,
		},
	});
}

export async function deleteMessageForMe({
	conversationId,
	messageId,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
}) {
	return await fetchRest(`/v4/chat/message/delete`, {
		method: "POST",
		body: {
			conversationId,
			messageId,
		},
	}).then((res) => res.assertOk());
}

export async function unsendMessage({
	conversationId,
	messageId,
}: {
	conversationId: Conversation["data"]["conversationId"];
	messageId: ApiResponseMessage["messageId"];
}) {
	return await fetchRest(`/v4/chat/message/unsend`, {
		method: "POST",
		body: {
			conversationId,
			messageId,
		},
	}).then((res) => res.assertOk());
}
