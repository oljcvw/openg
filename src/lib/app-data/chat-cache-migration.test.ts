import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	ledger: null as Record<string, unknown> | null,
	items: [] as Array<{ key: string; value: Record<string, unknown> }>,
	directHistory: new Set<string>(),
	upsert: vi.fn(),
	clearDirect: vi.fn(),
	clearShort: vi.fn(),
	setPreferences: vi.fn(),
	listPage: vi.fn(),
	writes: vi.fn(),
}));

vi.mock("$lib/api/account-caches", () => ({
	getAccountSessionSnapshot: () => ({ accountId: 7, generation: 1 }),
	isAccountSessionCurrent: () => true,
}));

vi.mock("$lib/app-data/direct-media-cache", () => ({
	upsertDirectMediaHistory: harness.upsert,
	clearDirectMediaCache: harness.clearDirect,
}));

vi.mock("$lib/app-data/preferences.svelte", () => ({
	setPreferences: harness.setPreferences,
}));

vi.mock("$lib/app-data/short-video-cache", () => ({
	clearShortVideoCache: harness.clearShort,
}));

vi.mock("./cache-manager", () => ({
	readCacheEntry: vi.fn(
		(
			_accountId: number,
			kind: string,
			_key: string,
			parse: (v: unknown) => unknown,
		) =>
			Promise.resolve(
				kind === "migration" && harness.ledger !== null
					? parse(harness.ledger)
					: null,
			),
	),
	listCacheEntryPage: harness.listPage,
	writeCacheEntry: harness.writes,
	removeCacheEntry: vi.fn(),
}));

import { migrateBeta4ConversationCaches } from "$lib/app-data/chat-cache";
import {
	captureSharedMediaRetentionAuthorization,
	setSharedMediaRetentionPreference,
	synchronizeSharedMediaRetentionState,
} from "$lib/app-data/shared-media-retention-preference";

function imageMessage(messageId: string, conversationId = "conversation") {
	return {
		type: "Image",
		body: {
			mediaId: Number(messageId.replace(/\D/g, "")) + 1,
			url: "https://images.example/image.jpg",
			width: 640,
			height: 480,
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: null,
		},
		messageId,
		conversationId,
		senderId: 42,
		timestamp: 1_710_000_000_000,
		unsent: false,
		reactions: [],
	};
}

function conversation(messages: ReturnType<typeof imageMessage>[]) {
	return {
		version: 1,
		messages,
		failedMessages: [],
		profile: {
			distance: null,
			mediaHash: null,
			name: null,
			onlineUntil: null,
			profileId: 42,
			showDistance: false,
		},
		pageKey: null,
		lastReadTimestamp: null,
		updatedAt: 1,
	};
}

describe("beta-5 conversation conversion", () => {
	beforeEach(() => {
		harness.ledger = null;
		harness.items = [];
		harness.directHistory.clear();
		harness.upsert
			.mockReset()
			.mockImplementation((entry: { messageId: string }) => {
				harness.directHistory.add(entry.messageId);
				return Promise.resolve();
			});
		harness.clearDirect.mockReset().mockImplementation(() => {
			harness.directHistory.clear();
			return Promise.resolve(undefined);
		});
		harness.clearShort.mockReset().mockResolvedValue(undefined);
		harness.setPreferences.mockReset().mockResolvedValue(undefined);
		synchronizeSharedMediaRetentionState(true);
		harness.listPage
			.mockReset()
			.mockImplementation(
				(
					_accountId: number,
					_kind: string,
					parse: (value: unknown) => Record<string, unknown>,
					cursor: string | null,
					pageSize: number,
				) => {
					const matching = harness.items.filter(
						(item) => cursor === null || item.key > cursor,
					);
					const page = matching.slice(0, pageSize);
					return Promise.resolve({
						items: page.map((item) => ({
							key: item.key,
							value: parse(item.value),
						})),
						nextCursor: matching.length > page.length ? page.at(-1)!.key : null,
					});
				},
			);
		harness.writes
			.mockReset()
			.mockImplementation(
				(
					_accountId: number,
					kind: string,
					key: string,
					value: Record<string, unknown>,
				) => {
					if (kind === "migration") harness.ledger = structuredClone(value);
					if (kind === "conversation") {
						const item = harness.items.find(
							(candidate) => candidate.key === key,
						);
						if (item) item.value = structuredClone(value);
					}
					return Promise.resolve();
				},
			);
	});

	it("rewrites opted-out beta-4 conversations without seeding retained media", async () => {
		harness.items = [
			{
				key: "conversation-0000",
				value: conversation([imageMessage("message-0", "conversation-0000")]),
			},
		];

		await expect(
			migrateBeta4ConversationCaches(7, { retentionAuthorization: null }),
		).resolves.toEqual({ conversations: 1, mediaEntries: 0 });
		expect(harness.upsert).not.toHaveBeenCalled();
		expect(harness.items[0]!.value.version).toBe(2);
	});

	it("lets retention disable win a suspended native upsert race", async () => {
		harness.items = [
			{
				key: "conversation-0000",
				value: conversation([imageMessage("message-0", "conversation-0000")]),
			},
		];
		let finishUpsert: (() => void) | undefined;
		harness.upsert.mockImplementationOnce(
			(entry: { messageId: string }) =>
				new Promise<void>((resolve) => {
					finishUpsert = () => {
						harness.directHistory.add(entry.messageId);
						resolve();
					};
				}),
		);
		const retentionAuthorization = captureSharedMediaRetentionAuthorization();
		expect(retentionAuthorization).not.toBeNull();
		const migration = migrateBeta4ConversationCaches(7, {
			retentionAuthorization,
		});
		await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledTimes(1));

		const disabling = setSharedMediaRetentionPreference(false);
		await vi.waitFor(() => expect(harness.setPreferences).toHaveBeenCalled());
		expect(harness.clearDirect).not.toHaveBeenCalled();
		finishUpsert?.();

		await expect(migration).resolves.toEqual({
			conversations: 1,
			mediaEntries: 0,
		});
		await disabling;
		expect(harness.directHistory.size).toBe(0);
		expect(harness.clearDirect).toHaveBeenCalledTimes(1);
		expect(harness.items[0]!.value.version).toBe(2);
	});

	it("pages 1,000 conversations with a hard per-step native-call bound", async () => {
		harness.items = Array.from({ length: 1_000 }, (_, index) => ({
			key: `conversation-${String(index).padStart(4, "0")}`,
			value: conversation([
				imageMessage(
					`message-${index}`,
					`conversation-${String(index).padStart(4, "0")}`,
				),
			]),
		}));

		let calls = 0;
		while (harness.ledger?.complete !== true) {
			const before = harness.upsert.mock.calls.length;
			await migrateBeta4ConversationCaches(7, {
				retentionAuthorization: captureSharedMediaRetentionAuthorization(),
			});
			const stepCalls = harness.upsert.mock.calls.length - before;
			expect(stepCalls).toBeLessThanOrEqual(60);
			calls += 1;
			expect(calls).toBeLessThan(25);
		}
		expect(harness.upsert).toHaveBeenCalledTimes(1_000);
		await expect(
			migrateBeta4ConversationCaches(7, {
				retentionAuthorization: captureSharedMediaRetentionAuthorization(),
			}),
		).resolves.toEqual({ conversations: 0, mediaEntries: 0 });
	});

	it("resumes within a large conversation after the last durable media seed", async () => {
		harness.items = [
			{
				key: "conversation-large",
				value: conversation(
					Array.from({ length: 120 }, (_, index) =>
						imageMessage(`message-${index}`, "conversation-large"),
					),
				),
			},
		];

		const first = await migrateBeta4ConversationCaches(7, {
			retentionAuthorization: captureSharedMediaRetentionAuthorization(),
		});
		expect(first).toEqual({ conversations: 0, mediaEntries: 60 });
		expect(harness.ledger).toMatchObject({
			activeConversationKey: "conversation-large",
			messageOffset: 60,
			complete: false,
		});
		expect(harness.items[0]!.value.version).toBe(1);

		const second = await migrateBeta4ConversationCaches(7, {
			retentionAuthorization: captureSharedMediaRetentionAuthorization(),
		});
		expect(second).toEqual({ conversations: 1, mediaEntries: 60 });
		expect(harness.upsert).toHaveBeenCalledTimes(120);
		expect(harness.items[0]!.value.version).toBe(2);
		expect(harness.ledger).toMatchObject({ complete: true, messageOffset: 0 });
	});
});
