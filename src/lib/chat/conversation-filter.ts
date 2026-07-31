import type { Conversation } from "$lib/model/messaging/conversations";

export type ConversationFilter = "all" | "favorites" | "unread";

export function filterConversations(
	conversations: readonly Conversation[],
	{
		filter,
		query,
	}: {
		filter: ConversationFilter;
		query: string;
	},
): Conversation[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	return conversations.filter((conversation) => {
		if (filter === "favorites" && !conversation.data.favorite) return false;
		if (filter === "unread" && conversation.data.unreadCount === 0)
			return false;
		return (
			normalizedQuery === "" ||
			conversation.data.name.toLocaleLowerCase().includes(normalizedQuery)
		);
	});
}
