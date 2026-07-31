import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

export function normalizeConversationSearchQuery(query: string): string {
	return query.trim().toLocaleLowerCase();
}

export function conversationRowMatchesQuery(
	conversation: Conversation,
	normalizedQuery: string,
): boolean {
	if (normalizedQuery === "") return true;
	return (
		conversation.data.name.toLocaleLowerCase().includes(normalizedQuery) ||
		(conversation.data.preview?.text
			?.toLocaleLowerCase()
			.includes(normalizedQuery) ??
			false)
	);
}

export function searchableMessageText(
	message: ApiResponseMessage,
): string | null {
	if (message.unsent) return null;
	switch (message.type) {
		case "Text":
			return message.body.text.toLocaleLowerCase();
		case "AlbumContentReply":
			return message.body.albumContentReply.toLocaleLowerCase();
		case "ProfilePhotoReply":
			return message.body.photoContentReply.toLocaleLowerCase();
		default:
			return null;
	}
}

export type ConversationFilter = "all" | "favorites" | "unread";

export function filterConversations(
	conversations: readonly Conversation[],
	{
		filter,
		messageMatchIds = [],
		query,
	}: {
		filter: ConversationFilter;
		messageMatchIds?: readonly string[];
		query: string;
	},
): Conversation[] {
	const normalizedQuery = normalizeConversationSearchQuery(query);
	const messageMatches = new Set(messageMatchIds);

	return conversations.filter((conversation) => {
		if (filter === "favorites" && !conversation.data.favorite) return false;
		if (filter === "unread" && conversation.data.unreadCount === 0)
			return false;
		return (
			normalizedQuery === "" ||
			conversationRowMatchesQuery(conversation, normalizedQuery) ||
			messageMatches.has(conversation.data.conversationId)
		);
	});
}
