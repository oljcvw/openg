import {
	ConversationUnavailableError,
	getConversationMessages,
} from "$lib/api/messaging/messages";
import { ConversationSearchIndex } from "$lib/chat/conversation-search-index";

export function createConversationSearchIndex(): ConversationSearchIndex {
	return new ConversationSearchIndex(async (args) => {
		try {
			const result = await getConversationMessages(args);
			return {
				messages: result.messages,
				nextPageKey: result.messages.at(-1)?.messageId ?? null,
			};
		} catch (error) {
			if (error instanceof ConversationUnavailableError) {
				return { messages: [], nextPageKey: null };
			}
			throw error;
		}
	});
}
