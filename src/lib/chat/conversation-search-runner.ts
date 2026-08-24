import {
	type ConversationSearchQuery,
	conversationSearchRevision,
} from "$lib/chat/conversation-search";
import type { ConversationSearchIndex } from "$lib/chat/conversation-search-index";
import type { Conversation } from "$lib/model/messaging/conversations";

const SEARCH_WORKERS = 3;

export async function runConversationSearch({
	index,
	query,
	getConversations,
	hasMoreConversations,
	conversationPageToken,
	loadMoreConversations,
	getPagingFailure,
	prime,
	isCurrent,
	onProgress,
}: {
	index: ConversationSearchIndex;
	query: ConversationSearchQuery;
	getConversations: () => Conversation[];
	hasMoreConversations: () => boolean;
	conversationPageToken: () => string;
	loadMoreConversations: () => Promise<void>;
	getPagingFailure: () => Error | null;
	prime: (conversation: Conversation) => void;
	isCurrent: () => boolean;
	onProgress: () => void;
}): Promise<void> {
	const checkedRevisions = new Map<string, string>();

	while (isCurrent()) {
		while (isCurrent() && hasMoreConversations()) {
			const before = conversationPageToken();
			await loadMoreConversations();
			const failure = getPagingFailure();
			if (failure) throw failure;
			if (hasMoreConversations() && conversationPageToken() === before) {
				throw new Error("Conversation pagination did not advance");
			}
		}

		const pending = getConversations().filter((conversation) => {
			const id = conversation.data.conversationId;
			return (
				checkedRevisions.get(id) !==
				conversationSearchRevision(conversation)
			);
		});
		if (pending.length === 0) return;

		let next = 0;
		const worker = async () => {
			while (isCurrent()) {
				const conversation = pending[next++];
				if (!conversation) return;
				const revision = conversationSearchRevision(conversation);
				prime(conversation);
				await index.ensureMatch({ conversation, query, isCurrent });
				if (!isCurrent()) return;
				checkedRevisions.set(
					conversation.data.conversationId,
					revision,
				);
				onProgress();
			}
		};
		await Promise.all(
			Array.from(
				{ length: Math.min(SEARCH_WORKERS, pending.length) },
				worker,
			),
		);
	}
}
