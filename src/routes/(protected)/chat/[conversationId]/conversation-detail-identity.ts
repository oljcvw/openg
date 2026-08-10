import type { AccountSessionSnapshot } from "$lib/api/account-caches";

export type ConversationDetailIdentity = {
	accountGeneration: number;
	accountProfileId: number;
	conversationId: string;
};

export type ConversationDetailOwner = {
	identity: ConversationDetailIdentity;
	key: string;
};

export function conversationDetailKey(
	identity: ConversationDetailIdentity,
): string {
	if (
		!Number.isSafeInteger(identity.accountGeneration) ||
		identity.accountGeneration < 0 ||
		!Number.isSafeInteger(identity.accountProfileId) ||
		identity.accountProfileId <= 0 ||
		identity.conversationId.length === 0
	)
		throw new TypeError("invalid conversation detail identity");
	return JSON.stringify([
		identity.accountGeneration,
		identity.accountProfileId,
		identity.conversationId,
	]);
}

export function assertCurrentConversationDetailIdentity(
	identity: ConversationDetailIdentity,
	session: AccountSessionSnapshot,
): void {
	conversationDetailKey(identity);
	if (
		session.accountId !== identity.accountProfileId ||
		session.generation !== identity.accountGeneration
	)
		throw new TypeError("conversation detail account mismatch");
}

export function resolveConversationDetailOwner({
	accountProfileId,
	accountSession,
	conversationId,
}: {
	accountProfileId: number;
	accountSession: AccountSessionSnapshot;
	conversationId: string;
}): ConversationDetailOwner | null {
	if (accountSession.accountId !== accountProfileId) return null;
	const identity = {
		accountGeneration: accountSession.generation,
		accountProfileId,
		conversationId,
	};
	return { identity, key: conversationDetailKey(identity) };
}
