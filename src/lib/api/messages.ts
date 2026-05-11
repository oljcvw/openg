import z from "zod";
import { fetchRest } from "$lib/api";
import { apiResponseMessageSchema, messageSchema } from "$lib/model/message";

const conversationMessageSchema = z.object({
	message: apiResponseMessageSchema,
});

const conversationMessagesSchema = z.object({
	messages: z.array(apiResponseMessageSchema),
	profile: z.object({
		distance: z.number().nullable(),
		mediaHash: z.string().nullable(),
		name: z.string().nullable(),
		onlineUntil: z.number().nullable(),
		profileId: z.number().int(),
		showDistance: z.boolean(),
	}),
});

export async function getConversationMessages({
	conversationId,
	pageKey,
}: {
	conversationId: string;
	pageKey?: string;
}) {
	const params = new URLSearchParams({ profile: "true" });
	if (pageKey !== undefined) params.set("pageKey", pageKey);
	const messages = await fetchRest(
		`/v5/chat/conversation/${conversationId}/message?` + params.toString(),
		{ method: "GET" },
	).then((res) => res.jsonParsed(conversationMessagesSchema));
	return messages;
}

export async function getConversationMessage({
	conversationId,
	messageId,
}: {
	conversationId: string;
	messageId: string;
}) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}/message/${encodeURIComponent(messageId)}`,
		{ method: "GET" },
	).then((res) => res.jsonParsed(conversationMessageSchema));
}

export async function refreshMessages({
	conversationId,
	messageIds,
}: {
	conversationId: string;
	messageIds: string[];
}) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}/message-by-id`,
		{
			method: "POST",
			body: { messageIds },
		},
	).then((res) =>
		res.jsonParsed(z.object({ messages: z.array(apiResponseMessageSchema) })),
	);
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
			body: message.body,
		},
	});
}

export async function markConversationRead({
	conversationId,
	messageId,
}: {
	conversationId: string;
	messageId: string;
}) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}/read/${encodeURIComponent(messageId)}`,
		{ method: "POST" },
	);
}

export async function unsendMessage({
	conversationId,
	messageId,
}: {
	conversationId: string;
	messageId: string;
}) {
	return await fetchRest("/v4/chat/message/unsend", {
		method: "POST",
		body: { conversationId, messageId },
	});
}

export async function deleteMessage({
	conversationId,
	messageId,
}: {
	conversationId: string;
	messageId: string;
}) {
	return await fetchRest("/v4/chat/message/delete", {
		method: "POST",
		body: { conversationId, messageId },
	});
}

export async function sendTypingStatus({
	conversationId,
	status,
}: {
	conversationId: string;
	status: "Typing" | "Cleared";
}) {
	return await fetchRest("/v4/chatstatus/typing", {
		method: "POST",
		body: { conversationId, status },
	});
}

export async function reactToMessage({
	conversationId,
	messageId,
	reactionType,
}: {
	conversationId: string;
	messageId: string;
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
