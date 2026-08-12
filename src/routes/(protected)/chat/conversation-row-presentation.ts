export type ConversationRowPresentation = {
	ariaCurrent: "page" | undefined;
	leadingCue: boolean;
	tone: "active" | "unread" | "neutral";
	unreadEmphasis: boolean;
};

export function conversationRowPresentation({
	active,
	unread,
}: {
	active: boolean;
	unread: boolean;
}): ConversationRowPresentation {
	return {
		ariaCurrent: active ? "page" : undefined,
		leadingCue: active || unread,
		tone: active ? "active" : unread ? "unread" : "neutral",
		unreadEmphasis: unread,
	};
}
