import z from "zod";
import { fetchRest } from "$lib/api";
import { fullConversationSchema } from "$lib/model/conversation";

const conversationsSchema = z.object({
	entries: z.array(fullConversationSchema),
	nextPage: z.number().nullable(),
});

export async function getConversations(page: number = 1) {
	const conversations = await fetchRest(
		"/v4/inbox?" + new URLSearchParams({ page: String(page) }).toString(),
		{
			method: "POST",
		},
	).then((res) => res.jsonParsed(conversationsSchema));
	return conversations;
}

export async function deleteConversation(conversationId: string) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}`,
		{ method: "DELETE" },
	);
}

export async function pinConversation(conversationId: string) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}/pin`,
		{ method: "POST" },
	);
}

export async function unpinConversation(conversationId: string) {
	return await fetchRest(
		`/v4/chat/conversation/${encodeURIComponent(conversationId)}/unpin`,
		{ method: "POST" },
	);
}

export async function muteConversation(conversationId: string) {
	return await fetchRest(
		`/v1/push/conversation/${encodeURIComponent(conversationId)}/mute`,
		{ method: "POST" },
	);
}

export async function unmuteConversation(conversationId: string) {
	return await fetchRest(
		`/v1/push/conversation/${encodeURIComponent(conversationId)}/unmute`,
		{ method: "POST" },
	);
}
