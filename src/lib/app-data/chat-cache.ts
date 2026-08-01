import z from "zod";

import {
	type Conversation,
	fullConversationSchema,
} from "$lib/model/messaging/conversations";
import {
	type ApiResponseMessage,
	apiResponseMessageSchema,
} from "$lib/model/messaging/messages";
import {
	readCacheEntry,
	removeCacheEntry,
	writeCacheEntry,
} from "./cache-manager";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONFIRMED_MESSAGES = 500;

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
	state: z.enum(["failed", "handled"]),
	lastAttemptAt: z.number().nonnegative(),
});

const cachedConversationSchema = z.object({
	version: z.literal(1).default(1),
	messages: z.array(apiResponseMessageSchema).default([]),
	failedMessages: z.array(failedMessageSchema).default([]),
	profile: conversationProfileSchema,
	pageKey: z.string().nullable(),
	lastReadTimestamp: z.number().nullable(),
	updatedAt: z.number().nonnegative(),
});

const cachedInboxSchema = z.object({
	version: z.literal(1).default(1),
	entries: z.array(fullConversationSchema),
	failedConversationIds: z.array(z.string()).default([]),
	nextPage: z.number().nullable(),
	updatedAt: z.number().nonnegative(),
});

export type FailedCachedMessage = z.infer<typeof failedMessageSchema>;
export type PersistedConversation = z.infer<typeof cachedConversationSchema>;
export type PersistedInbox = z.infer<typeof cachedInboxSchema>;

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
	return await readCacheEntry(
		accountId,
		"conversation",
		conversationId,
		(value) => cachedConversationSchema.parse(value),
	);
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
