import { invoke, isTauri } from "@tauri-apps/api/core";
import z from "zod";

const remoteAvailabilitySchema = z.enum([
	"available",
	"expired",
	"views_exhausted",
	"retracted",
]);
const cacheAvailabilitySchema = z.enum(["cached", "not_cached", "evicted"]);
const kindSchema = z.enum(["image", "video"]);
const messageTypeSchema = z.enum([
	"Image",
	"ExpiringImage",
	"Video",
	"PrivateVideo",
	"NonExpiringVideo",
]);
const storedSchema = z.object({
	token: z.string().min(1),
	protocolUrl: z.string().min(1),
	byteLength: z.number().int().positive(),
	contentType: z.string().min(1),
});
const lookupSchema = z.discriminatedUnion("found", [
	z.object({ found: z.literal(false) }),
	z.object({
		found: z.literal(true),
		token: z.string().min(1),
		protocolUrl: z.string().min(1),
		byteLength: z.number().int().positive(),
		contentType: z.string().min(1),
	}),
]);
const presenceSchema = z.object({
	exists: z.boolean(),
	cacheAvailability: cacheAvailabilitySchema,
	byteLength: z.number().int().positive().nullable(),
});
const entrySchema = z.object({
	accountProfileId: z.coerce.number().int().nonnegative(),
	conversationId: z.string().min(1),
	peerProfileId: z.coerce.number().int().nonnegative(),
	messageId: z.string().min(1),
	mediaId: z.string().min(1),
	kind: kindSchema,
	messageType: messageTypeSchema,
	sentAt: z.number().int().nonnegative(),
	remoteAvailability: remoteAvailabilitySchema,
	cacheAvailability: cacheAvailabilitySchema,
	cacheToken: z.string().min(1).nullable(),
	protocolUrl: z.string().min(1).nullable().default(null),
	contentType: z.string().min(1).nullable(),
	byteLength: z.number().int().positive().nullable(),
	lastAccessedMs: z.number().int().nonnegative(),
});
const pageSchema = z.object({
	items: z.array(entrySchema),
	nextCursor: z.string().min(1).nullable(),
	totalCount: z.number().int().nonnegative(),
});
const statsSchema = z.object({
	byteLength: z.number().int().nonnegative(),
	cachedCount: z.number().int().nonnegative(),
	historyCount: z.number().int().nonnegative(),
	accountCount: z.number().int().nonnegative(),
	cacheEpoch: z.number().int().nonnegative(),
});

export type DirectMediaRemoteAvailability = z.infer<
	typeof remoteAvailabilitySchema
>;
export type DirectMediaCacheAvailability = z.infer<
	typeof cacheAvailabilitySchema
>;
export type DirectMediaHistoryEntry = z.infer<typeof entrySchema>;
export type DirectMediaCacheStats = z.infer<typeof statsSchema>;

const historyFingerprints = new Map<string, Map<string, string>>();
const historyFingerprintGenerations = new Map<number, number>();
let historyFingerprintEpoch = 0;

type Identity = {
	accountProfileId: number;
	conversationId: string;
	peerProfileId: number;
	messageId: string;
	mediaId: string;
};
export type DirectMediaHistoryDelta = Identity & {
	kind: z.infer<typeof kindSchema>;
	messageType: z.infer<typeof messageTypeSchema>;
	sentAt: number;
	remoteAvailability: DirectMediaRemoteAvailability;
};

function nativeIdentity(identity: Identity) {
	return {
		accountId: String(identity.accountProfileId),
		conversationId: identity.conversationId,
		peerProfileId: String(identity.peerProfileId),
		messageId: identity.messageId,
		mediaId: identity.mediaId,
	};
}

export async function upsertDirectMediaHistory(
	input: DirectMediaHistoryDelta,
): Promise<void> {
	await upsertDirectMediaHistoryBatch([input]);
}

export async function upsertDirectMediaHistoryBatch(
	deltas: readonly DirectMediaHistoryDelta[],
): Promise<void> {
	if (!isTauri() || deltas.length === 0) return;
	const changed = deltas.filter((delta) => {
		const scope = `${delta.accountProfileId}\0${delta.conversationId}`;
		const identity = `${delta.peerProfileId}\0${delta.messageId}\0${delta.mediaId}`;
		const fingerprint = `${delta.kind}\0${delta.messageType}\0${delta.sentAt}\0${delta.remoteAvailability}`;
		return historyFingerprints.get(scope)?.get(identity) !== fingerprint;
	});
	if (changed.length === 0) return;
	const capturedEpoch = historyFingerprintEpoch;
	const capturedGenerations = new Map(
		changed.map((delta) => [
			delta.accountProfileId,
			historyFingerprintGenerations.get(delta.accountProfileId) ?? 0,
		]),
	);
	await invoke("direct_media_cache_upsert_batch", {
		deltas: changed.map((input) => ({
			...nativeIdentity(input),
			kind: input.kind,
			messageType: input.messageType,
			sentAt: input.sentAt,
			remoteAvailability: input.remoteAvailability,
		})),
	});
	for (const delta of changed) {
		if (
			historyFingerprintEpoch !== capturedEpoch ||
			(historyFingerprintGenerations.get(delta.accountProfileId) ?? 0) !==
				capturedGenerations.get(delta.accountProfileId)
		)
			continue;
		const scope = `${delta.accountProfileId}\0${delta.conversationId}`;
		const identity = `${delta.peerProfileId}\0${delta.messageId}\0${delta.mediaId}`;
		const fingerprint = `${delta.kind}\0${delta.messageType}\0${delta.sentAt}\0${delta.remoteAvailability}`;
		let entries = historyFingerprints.get(scope);
		if (!entries) {
			entries = new Map();
			historyFingerprints.set(scope, entries);
		}
		entries.set(identity, fingerprint);
	}
}

export function resetDirectMediaHistoryFingerprints(
	accountProfileId?: number,
): void {
	if (accountProfileId === undefined) {
		historyFingerprints.clear();
		historyFingerprintEpoch += 1;
		return;
	}
	historyFingerprintGenerations.set(
		accountProfileId,
		(historyFingerprintGenerations.get(accountProfileId) ?? 0) + 1,
	);
	const prefix = `${accountProfileId}\0`;
	for (const scope of historyFingerprints.keys()) {
		if (scope.startsWith(prefix)) historyFingerprints.delete(scope);
	}
}

export async function storeDirectMedia(
	input: DirectMediaHistoryDelta & {
		sourceUrl: string;
		contentType: string;
		maximumBytes: number;
		scopeToken: string;
	},
) {
	if (!isTauri()) return null;
	return storedSchema.parse(
		await invoke("direct_media_cache_store", {
			...nativeIdentity(input),
			kind: input.kind,
			messageType: input.messageType,
			sentAt: input.sentAt,
			remoteAvailability: input.remoteAvailability,
			sourceUrl: input.sourceUrl,
			contentType: input.contentType,
			maximumBytes: input.maximumBytes,
			scopeToken: input.scopeToken,
		}),
	);
}

export async function importLegacyDirectMedia(
	input: DirectMediaHistoryDelta & {
		dataBase64: string;
		contentType: string;
		maximumBytes: number;
		scopeToken: string;
	},
) {
	if (!isTauri()) return null;
	return storedSchema.parse(
		await invoke("direct_media_cache_import_legacy", {
			...nativeIdentity(input),
			kind: input.kind,
			messageType: input.messageType,
			sentAt: input.sentAt,
			remoteAvailability: input.remoteAvailability,
			dataBase64: input.dataBase64,
			contentType: input.contentType,
			maximumBytes: input.maximumBytes,
			scopeToken: input.scopeToken,
		}),
	);
}

export async function setDirectMediaCacheScope(
	accountProfileId: number,
	scopeToken: string | null,
	conversationId: string | null = null,
	peerProfileId: number | null = null,
): Promise<void> {
	if (!isTauri()) return;
	await invoke("direct_media_cache_set_scope", {
		accountId: String(accountProfileId),
		scopeToken,
		conversationId,
		peerProfileId: peerProfileId === null ? null : String(peerProfileId),
	});
}

export async function lookupDirectMedia(identity: Identity) {
	if (!isTauri()) return { found: false } as const;
	return lookupSchema.parse(
		await invoke("direct_media_cache_lookup", nativeIdentity(identity)),
	);
}

export async function getDirectMediaPresence(identity: Identity) {
	if (!isTauri())
		return {
			exists: false,
			cacheAvailability: "not_cached" as const,
			byteLength: null,
		};
	return presenceSchema.parse(
		await invoke("direct_media_cache_presence", nativeIdentity(identity)),
	);
}

export async function listDirectMediaHistory(options: {
	accountProfileId: number;
	conversationId: string;
	peerProfileId: number;
	cursor?: string | null;
	pageSize?: number;
}) {
	if (!isTauri()) return { items: [], nextCursor: null, totalCount: 0 };
	return pageSchema.parse(
		await invoke("direct_media_cache_list", {
			accountId: String(options.accountProfileId),
			conversationId: options.conversationId,
			peerProfileId: String(options.peerProfileId),
			cursor: options.cursor ?? null,
			pageSize: options.pageSize ?? 60,
		}),
	);
}

export async function trimDirectMediaCache(maximumBytes: number) {
	if (!isTauri()) return emptyStats();
	return statsSchema.parse(
		await invoke("direct_media_cache_trim", { maximumBytes }),
	);
}

export async function clearDirectMediaCache(accountProfileId?: number) {
	if (!isTauri()) return emptyStats();
	const result = statsSchema.parse(
		await invoke("direct_media_cache_clear", {
			accountId:
				accountProfileId === undefined ? null : String(accountProfileId),
		}),
	);
	resetDirectMediaHistoryFingerprints(accountProfileId);
	return result;
}

export async function getDirectMediaCacheStats(accountProfileId?: number) {
	if (!isTauri()) return emptyStats();
	return statsSchema.parse(
		await invoke("direct_media_cache_stats", {
			accountId:
				accountProfileId === undefined ? null : String(accountProfileId),
		}),
	);
}

function emptyStats(): DirectMediaCacheStats {
	return {
		byteLength: 0,
		cachedCount: 0,
		historyCount: 0,
		accountCount: 0,
		cacheEpoch: 0,
	};
}
