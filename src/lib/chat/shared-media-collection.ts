import {
	classifyReceivedSharedMedia,
	type SharedMediaContext,
	type SharedMediaEntry,
} from "$lib/chat/shared-media";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

const HISTORY_PAGE_SIZE = 60;

export type SharedMediaHistoryPage = {
	entries: SharedMediaEntry[];
	nextPage: number | null;
};

export type ConversationMediaPage = {
	messages: ApiResponseMessage[];
	nextPageKey: string | null;
};

function newestFirst(left: SharedMediaEntry, right: SharedMediaEntry): number {
	return (
		right.sentAt - left.sentAt || right.messageId.localeCompare(left.messageId)
	);
}

function validatedRetained(
	entry: SharedMediaEntry,
	context: SharedMediaContext,
): boolean {
	return (
		entry.accountProfileId === context.accountProfileId &&
		entry.conversationId === context.conversationId &&
		entry.peerProfileId === context.peerProfileId
	);
}

/**
 * Reconciles the exact conversation without allowing an uncorrelated media
 * endpoint or a durable record from another account/peer to originate a tile.
 */
export function mergeSharedMediaSources({
	context,
	active,
	cached,
	retained,
}: {
	context: SharedMediaContext;
	active: readonly ApiResponseMessage[];
	cached: readonly ApiResponseMessage[];
	retained: readonly SharedMediaEntry[];
}): SharedMediaEntry[] {
	const retainedByMessage = new Map(
		retained
			.filter((entry) => validatedRetained(entry, context))
			.map((entry) => [entry.messageId, entry] as const),
	);
	const byMessage = new Map<string, SharedMediaEntry>();

	// Lower-priority cache copies are inserted first. Active/server state then
	// replaces their remote availability and URL while preserving durable bytes.
	for (const source of [cached, active]) {
		for (const message of source) {
			if (
				message.conversationId === context.conversationId &&
				message.senderId === context.peerProfileId &&
				message.unsent
			) {
				const durable = retainedByMessage.get(message.messageId);
				if (durable?.cacheAvailability === "cached") {
					byMessage.set(message.messageId, {
						...durable,
						remoteAvailability: "retracted",
						remoteUrl: null,
					});
				} else {
					byMessage.delete(message.messageId);
					retainedByMessage.delete(message.messageId);
				}
				continue;
			}
			const classified = classifyReceivedSharedMedia(message, context);
			if (!classified) continue;
			const durable = retainedByMessage.get(classified.messageId);
			byMessage.set(classified.messageId, {
				...classified,
				cacheAvailability:
					durable?.cacheAvailability ?? classified.cacheAvailability,
				cacheToken: durable?.cacheToken ?? classified.cacheToken,
			});
		}
	}

	for (const durable of retainedByMessage.values()) {
		if (!byMessage.has(durable.messageId))
			byMessage.set(durable.messageId, durable);
	}
	return [...byMessage.values()].toSorted(newestFirst);
}

export class SharedMediaCollection {
	entries: SharedMediaEntry[];
	nextPageKey: string | null;
	loading = false;
	error: unknown | null = null;

	readonly #context: SharedMediaContext;
	readonly #fetchPage: (pageKey: string) => Promise<ConversationMediaPage>;
	#active: ApiResponseMessage[];
	#cached: ApiResponseMessage[];
	#retained: SharedMediaEntry[];
	#seenPageKeys = new Set<string>();

	constructor({
		context,
		active,
		cached,
		retained,
		initialPageKey,
		fetchPage,
	}: {
		context: SharedMediaContext;
		active: ApiResponseMessage[];
		cached: ApiResponseMessage[];
		retained: SharedMediaEntry[];
		initialPageKey: string | null;
		fetchPage: (pageKey: string) => Promise<ConversationMediaPage>;
	}) {
		this.#context = context;
		this.#active = active;
		this.#cached = cached;
		this.#retained = retained;
		this.#fetchPage = fetchPage;
		this.nextPageKey = initialPageKey;
		this.entries = this.#merge();
	}

	#merge(): SharedMediaEntry[] {
		return mergeSharedMediaSources({
			context: this.#context,
			active: this.#active,
			cached: this.#cached,
			retained: this.#retained,
		});
	}

	updateActive(messages: ApiResponseMessage[]): void {
		this.#active = messages;
		this.entries = this.#merge();
	}

	async loadOlder(): Promise<void> {
		const pageKey = this.nextPageKey;
		if (this.loading || pageKey === null) return;
		if (this.#seenPageKeys.has(pageKey)) {
			this.nextPageKey = null;
			return;
		}
		this.loading = true;
		this.error = null;
		this.#seenPageKeys.add(pageKey);
		try {
			const page = await this.#fetchPage(pageKey);
			this.#cached = [...this.#cached, ...page.messages];
			this.entries = this.#merge();
			this.nextPageKey =
				page.messages.length === 0 ||
				page.nextPageKey === null ||
				this.#seenPageKeys.has(page.nextPageKey)
					? null
					: page.nextPageKey;
		} catch (error) {
			this.error = error;
			this.#seenPageKeys.delete(pageKey);
		} finally {
			this.loading = false;
		}
	}

	historyPage(page: number): SharedMediaHistoryPage {
		const offset = Math.max(0, page) * HISTORY_PAGE_SIZE;
		const entries = this.#retained
			.filter((entry) => validatedRetained(entry, this.#context))
			.toSorted(newestFirst)
			.slice(offset, offset + HISTORY_PAGE_SIZE);
		return {
			entries,
			nextPage:
				offset + entries.length < this.#retained.length ? page + 1 : null,
		};
	}
}
