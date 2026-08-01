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
	showRetractedMessages = true,
	retractedMessageIds: ReadonlySet<string> = new Set(),
): string | null {
	if (message.unsent) return null;
	if (!showRetractedMessages && retractedMessageIds.has(message.messageId)) {
		return null;
	}
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

export function messageCorpusMatchesQuery(
	textByMessageId: ReadonlyMap<string, string>,
	retractedMessageIds: ReadonlySet<string>,
	normalizedQuery: string,
	showRetractedMessages: boolean,
): boolean {
	return [...textByMessageId.entries()].some(
		([messageId, text]) =>
			(showRetractedMessages || !retractedMessageIds.has(messageId)) &&
			text.includes(normalizedQuery),
	);
}

export type ConversationFilter = "all" | "failed" | "favorites" | "unread";

export function filterConversations(
	conversations: readonly Conversation[],
	{
		filter,
		messageMatchIds = [],
		failedConversationIds = [],
		query,
	}: {
		filter: ConversationFilter;
		messageMatchIds?: readonly string[];
		failedConversationIds?: readonly string[];
		query: string;
	},
): Conversation[] {
	const normalizedQuery = normalizeConversationSearchQuery(query);
	const messageMatches = new Set(messageMatchIds);
	const failedConversations = new Set(failedConversationIds);

	return conversations.filter((conversation) => {
		if (filter === "favorites" && !conversation.data.favorite) return false;
		if (filter === "unread" && conversation.data.unreadCount === 0)
			return false;
		if (
			filter === "failed" &&
			!failedConversations.has(conversation.data.conversationId)
		)
			return false;
		return (
			normalizedQuery === "" ||
			conversationRowMatchesQuery(conversation, normalizedQuery) ||
			messageMatches.has(conversation.data.conversationId)
		);
	});
}
