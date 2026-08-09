import z from "zod";

import {
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
} from "$lib/api/account-caches";
import { upsertDirectMediaHistory } from "$lib/app-data/direct-media-cache";
import {
	beginSharedMediaRetentionWrite,
	isSharedMediaRetentionAuthorizationCurrent,
	type SharedMediaRetentionAuthorization,
} from "$lib/app-data/shared-media-retention-preference";
import { classifyReceivedSharedMedia } from "$lib/chat/shared-media";
import {
	type Conversation,
	fullConversationSchema,
} from "$lib/model/messaging/conversations";
import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
} from "$lib/model/messaging/messages";
import {
	listCacheEntryPage,
	readCacheEntry,
	removeCacheEntry,
	writeCacheEntry,
} from "./cache-manager";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONFIRMED_MESSAGES = 500;
const BETA5_CONVERSATION_MIGRATION_KEY = "beta5-conversations";

const conversationProfileSchema = z.object({
	distance: z.number().nullable(),
	mediaHash: z.string().nullable(),
	name: z.string().nullable(),
	onlineUntil: z.number().nullable(),
	profileId: z.number(),
	showDistance: z.boolean(),
});

const failedMessageSchema = z.object({
	localId: z.string(),
	message: apiResponseMessageSchema,
	state: z.enum(["queued", "awaitingAck", "confirming", "failed", "handled"]),
	lastAttemptAt: z.number().nonnegative(),
	attemptRef: z.string().optional(),
	outerCommandRef: z.string().optional(),
	retryCount: z.number().int().nonnegative().default(0),
});

const messageSegmentMetadataSchema = z.object({
	segmentId: z.string(),
	cursor: z.string().nullable(),
	nextCursor: z.string().nullable(),
	messageIds: z.array(z.string()),
});

const cachedConversationSchema = z.object({
	version: z.union([z.literal(1), z.literal(2)]).default(2),
	messages: z.array(apiResponseMessageSchema).default([]),
	failedMessages: z.array(failedMessageSchema).default([]),
	profile: conversationProfileSchema,
	pageKey: z.string().nullable(),
	lastReadTimestamp: z.number().nullable(),
	segments: z.array(messageSegmentMetadataSchema).default([]),
	updatedAt: z.number().nonnegative(),
});

const cachedInboxSchema = z.object({
	version: z.literal(1).default(1),
	entries: z.array(fullConversationSchema),
	failedConversationIds: z.array(z.string()).default([]),
	nextPage: z.number().nullable(),
	updatedAt: z.number().nonnegative(),
});

const conversationMigrationLedgerSchema = z.object({
	version: z.literal(5),
	cursor: z.string().nullable(),
	complete: z.boolean(),
	activeConversationKey: z.string().nullable().default(null),
	messageOffset: z.number().int().nonnegative().default(0),
});

export type FailedCachedMessage = z.infer<typeof failedMessageSchema>;
export type PersistedConversation = z.infer<typeof cachedConversationSchema>;
export type PersistedInbox = z.infer<typeof cachedInboxSchema>;

export function migratePersistedConversationToV2(
	value: unknown,
): PersistedConversation {
	const parsed = cachedConversationSchema.parse(value);
	return cachedConversationSchema.parse({
		...parsed,
		version: 2,
		failedMessages: parsed.failedMessages.map((failed) => ({
			...failed,
			retryCount: failed.retryCount ?? 0,
		})),
	});
}

export function pruneConfirmedMessages(
	messages: readonly ApiResponseMessage[],
	now: number = Date.now(),
): ApiResponseMessage[] {
	const cutoff = now - RETENTION_MS;
	return messages
		.filter((message) => message.timestamp >= cutoff)
		.toSorted((left, right) => right.timestamp - left.timestamp)
		.slice(0, MAX_CONFIRMED_MESSAGES);
}

export function mergeConfirmedMessages(
	existing: readonly ApiResponseMessage[],
	incoming: readonly ApiResponseMessage[],
	removedMessageIds: ReadonlySet<string> = new Set(),
): ApiResponseMessage[] {
	const byId = new Map<string, ApiResponseMessage>();
	for (const message of existing) {
		if (!removedMessageIds.has(message.messageId)) {
			byId.set(message.messageId, message);
		}
	}
	for (const message of incoming) {
		if (!removedMessageIds.has(message.messageId)) {
			byId.set(message.messageId, message);
		}
	}
	return [...byId.values()].toSorted(
		(left, right) =>
			right.timestamp - left.timestamp ||
			left.messageId.localeCompare(right.messageId),
	);
}

export async function readCachedInbox(
	accountId: number,
): Promise<PersistedInbox | null> {
	return await readCacheEntry(accountId, "inbox", "inbox", (value) =>
		cachedInboxSchema.parse(value),
	);
}

export async function writeCachedInbox(
	accountId: number,
	entries: readonly Conversation[],
	nextPage: number | null,
	failedConversationIds: readonly string[] = [],
): Promise<void> {
	await writeCacheEntry(
		accountId,
		"inbox",
		"inbox",
		cachedInboxSchema.parse({
			entries,
			failedConversationIds,
			nextPage,
			updatedAt: Date.now(),
		}),
	);
}

export async function readCachedConversation(
	accountId: number,
	conversationId: string,
): Promise<PersistedConversation | null> {
	const cached = await readCacheEntry(
		accountId,
		"conversation",
		conversationId,
		(value) => cachedConversationSchema.parse(value),
	);
	if (cached?.version !== 1) return cached;
	const migrated = migratePersistedConversationToV2(cached);
	await writeCacheEntry(accountId, "conversation", conversationId, migrated);
	return migrated;
}

/**
 * Converts all beta-4 conversation records in bounded pages and seeds durable
 * received-media history without downloading any media bytes.
 */
export async function migrateBeta4ConversationCaches(
	accountId: number,
	options: {
		retentionAuthorization: SharedMediaRetentionAuthorization | null;
		pageSize?: number;
		maxMediaEntries?: number;
	},
): Promise<{ conversations: number; mediaEntries: number }> {
	const session = getAccountSessionSnapshot();
	if (session.accountId !== accountId)
		return { conversations: 0, mediaEntries: 0 };
	const ledger = (await readCacheEntry(
		accountId,
		"migration",
		BETA5_CONVERSATION_MIGRATION_KEY,
		(value) => conversationMigrationLedgerSchema.parse(value),
	)) ?? {
		version: 5 as const,
		cursor: null,
		complete: false,
		activeConversationKey: null,
		messageOffset: 0,
	};
	if (ledger.complete) return { conversations: 0, mediaEntries: 0 };
	let conversations = 0;
	let mediaEntries = 0;
	const maximumMediaEntries = Math.min(
		60,
		Math.max(1, Math.trunc(options.maxMediaEntries ?? 60)),
	);
	let completedCursor = ledger.cursor;
	let activeConversationKey = ledger.activeConversationKey;
	let messageOffset = ledger.messageOffset;
	let stoppedForMediaBudget = false;
	let retentionAuthorization = options.retentionAuthorization;
	const page = await listCacheEntryPage(
		accountId,
		"conversation",
		(value) => cachedConversationSchema.parse(value),
		ledger.cursor,
		Math.min(60, Math.max(1, Math.trunc(options.pageSize ?? 60))),
	);
	if (!isAccountSessionCurrent(session))
		return { conversations: 0, mediaEntries: 0 };
	for (const item of page.items) {
		if (!isAccountSessionCurrent(session)) break;
		if (item.value.version === 1) {
			const migrated = migratePersistedConversationToV2(item.value);
			if (retentionAuthorization !== null) {
				const start = activeConversationKey === item.key ? messageOffset : 0;
				for (let index = start; index < migrated.messages.length; index += 1) {
					const message = migrated.messages[index];
					const entry = classifyReceivedSharedMedia(message, {
						accountProfileId: accountId,
						conversationId: item.key,
						peerProfileId: migrated.profile.profileId,
					});
					if (entry === null) continue;
					if (mediaEntries >= maximumMediaEntries) {
						activeConversationKey = item.key;
						messageOffset = index;
						stoppedForMediaBudget = true;
						break;
					}
					const finishRetentionWrite = beginSharedMediaRetentionWrite(
						retentionAuthorization,
					);
					if (finishRetentionWrite === null) {
						retentionAuthorization = null;
						break;
					}
					let authorizationStillCurrent: boolean;
					try {
						await upsertDirectMediaHistory({
							accountProfileId: entry.accountProfileId,
							conversationId: entry.conversationId,
							peerProfileId: entry.peerProfileId,
							messageId: entry.messageId,
							mediaId: entry.mediaId,
							kind: entry.kind,
							messageType: entry.messageType,
							sentAt: entry.sentAt,
							remoteAvailability: entry.remoteAvailability,
						});
						authorizationStillCurrent =
							isSharedMediaRetentionAuthorizationCurrent(
								retentionAuthorization,
							);
					} finally {
						finishRetentionWrite();
					}
					if (!authorizationStillCurrent) {
						retentionAuthorization = null;
						break;
					}
					mediaEntries += 1;
					activeConversationKey = item.key;
					messageOffset = index + 1;
					await writeCacheEntry(
						accountId,
						"migration",
						BETA5_CONVERSATION_MIGRATION_KEY,
						{
							version: 5,
							cursor: completedCursor,
							complete: false,
							activeConversationKey,
							messageOffset,
						},
					);
				}
				if (stoppedForMediaBudget) break;
			}
			if (!isAccountSessionCurrent(session)) break;
			await writeCacheEntry(accountId, "conversation", item.key, migrated);
			conversations += 1;
		}
		completedCursor = item.key;
		activeConversationKey = null;
		messageOffset = 0;
		if (!isAccountSessionCurrent(session)) break;
		await writeCacheEntry(
			accountId,
			"migration",
			BETA5_CONVERSATION_MIGRATION_KEY,
			{
				version: 5,
				cursor: completedCursor,
				complete: false,
				activeConversationKey,
				messageOffset,
			},
		);
	}
	if (
		isAccountSessionCurrent(session) &&
		!stoppedForMediaBudget &&
		page.nextCursor === null
	) {
		await writeCacheEntry(
			accountId,
			"migration",
			BETA5_CONVERSATION_MIGRATION_KEY,
			{
				version: 5,
				cursor: completedCursor,
				complete: true,
				activeConversationKey: null,
				messageOffset: 0,
			},
		);
	} else if (isAccountSessionCurrent(session) && stoppedForMediaBudget) {
		await writeCacheEntry(
			accountId,
			"migration",
			BETA5_CONVERSATION_MIGRATION_KEY,
			{
				version: 5,
				cursor: completedCursor,
				complete: false,
				activeConversationKey,
				messageOffset,
			},
		);
	}
	return { conversations, mediaEntries };
}

export async function writeCachedConversation(
	accountId: number,
	conversationId: string,
	conversation: Omit<PersistedConversation, "version" | "updatedAt">,
): Promise<void> {
	await writeCacheEntry(
		accountId,
		"conversation",
		conversationId,
		cachedConversationSchema.parse({
			...conversation,
			messages: pruneConfirmedMessages(conversation.messages),
			updatedAt: Date.now(),
		}),
	);
}

export async function removeCachedConversation(
	accountId: number,
	conversationId: string,
): Promise<void> {
	await removeCacheEntry(accountId, "conversation", conversationId);
}
