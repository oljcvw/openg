import type { Conversation } from "$lib/model/messaging/conversations";
import type {
	ApiResponseMessage,
	QuotedMessage,
} from "$lib/model/messaging/messages";

export type ConversationSearchQuery = { key: string; terms: readonly string[] };

export function normalizeSearchText(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase();
}

export function searchMatchPreview(
	value: string,
	terms: readonly string[],
	maxLength = 120,
): string {
	const text = value.replace(/\s+/gu, " ").trim();
	if (text.length <= maxLength) return text;

	let normalized = "";
	const sourceOffsets: number[] = [];
	for (let offset = 0; offset < text.length; ) {
		const codePoint = text.codePointAt(offset);
		if (codePoint === undefined) break;
		const character = String.fromCodePoint(codePoint);
		const normalizedCharacter = normalizeSearchText(character);
		normalized += normalizedCharacter;
		for (let i = 0; i < normalizedCharacter.length; i += 1) {
			sourceOffsets.push(offset);
		}
		offset += character.length;
	}
	sourceOffsets.push(text.length);

	let matchStart = Number.POSITIVE_INFINITY;
	let matchEnd = 0;
	for (const term of terms) {
		const index = normalized.indexOf(term);
		if (index < 0 || index >= matchStart) continue;
		matchStart = index;
		matchEnd = index + term.length;
	}

	if (!Number.isFinite(matchStart)) return `${text.slice(0, maxLength)}…`;
	const sourceStart = sourceOffsets[matchStart] ?? 0;
	const sourceEnd = sourceOffsets[matchEnd] ?? text.length;
	const matchLength = Math.max(1, sourceEnd - sourceStart);
	const beforeLength = Math.max(0, Math.floor((maxLength - matchLength) / 2));
	let start = Math.max(0, sourceStart - beforeLength);
	const end = Math.min(text.length, start + maxLength);
	start = Math.max(0, end - maxLength);

	return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function compileConversationSearch(
	query: string,
): ConversationSearchQuery {
	const terms = [
		...new Set(
			normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean),
		),
	];
	return { key: terms.join("\u0000"), terms };
}

export function conversationSearchRevision(conversation: Conversation): string {
	return [
		conversation.data.name,
		conversation.data.preview?.text ?? "",
		conversation.data.lastActivityTimestamp,
	].join("\u0000");
}

export function conversationSearchBaseChunks(
	conversation: Conversation,
): string[] {
	return [conversation.data.name, conversation.data.preview?.text]
		.filter(
			(value): value is string => value !== null && value !== undefined,
		)
		.map(normalizeSearchText)
		.filter(Boolean);
}

function directMessageTextValues(
	message: ApiResponseMessage | QuotedMessage,
): string[] {
	const values: string[] = [];
	switch (message.type) {
		case "Text":
			values.push(message.body.text);
			break;
		case "AlbumContentReply":
			values.push(message.body.albumContentReply);
			break;
		case "ProfilePhotoReply":
			values.push(message.body.photoContentReply);
			break;
	}

	return values;
}

export function messageSearchTextValues(message: ApiResponseMessage): string[] {
	return [
		...directMessageTextValues(message),
		...(message.replyToMessage
			? directMessageTextValues(message.replyToMessage)
			: []),
	].filter(Boolean);
}

export function messageSearchChunks(message: ApiResponseMessage): string[] {
	return messageSearchTextValues(message)
		.map(normalizeSearchText)
		.filter(Boolean);
}

export function searchChunksMatch(
	chunks: readonly string[],
	query: ConversationSearchQuery,
): boolean {
	return searchChunkGroupsMatch([chunks], query);
}

export function searchChunkGroupsMatch(
	chunkGroups: readonly (readonly string[])[],
	query: ConversationSearchQuery,
): boolean {
	if (query.terms.length === 0) return true;
	return query.terms.every((term) =>
		chunkGroups.some((chunks) =>
			chunks.some((chunk) => chunk.includes(term)),
		),
	);
}

export function conversationMatchesSearch(
	conversation: Conversation,
	query: string | ConversationSearchQuery,
	historyChunks: readonly string[] = [],
): boolean {
	const compiled =
		typeof query === "string" ? compileConversationSearch(query) : query;
	return searchChunkGroupsMatch(
		[conversationSearchBaseChunks(conversation), historyChunks],
		compiled,
	);
}
