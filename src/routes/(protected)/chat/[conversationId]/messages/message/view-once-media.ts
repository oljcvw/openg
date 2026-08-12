import { lookupDirectMedia } from "$lib/app-data/direct-media-cache";
import { retainAuthorizedDirectMedia } from "$lib/app-data/direct-media-retention";
import type { SharedMediaEntry } from "$lib/chat/shared-media";

type AuthorizedMedia = { url: string; contentType: string };
type CacheLookup = { found: false } | { found: true; protocolUrl: string };

export type ViewOnceMediaDependencies = {
	lookup(entry: SharedMediaEntry): Promise<CacheLookup>;
	retain(entry: SharedMediaEntry, contentType: string): Promise<string | null>;
};

const defaultDependencies: ViewOnceMediaDependencies = {
	lookup: lookupDirectMedia,
	retain: retainAuthorizedDirectMedia,
};

/**
 * Resolves one consumptive message without speculative authorization.
 * The first explicit open is memoized so retries cannot consume another view.
 */
export class ExplicitViewOnceMediaSource {
	#authorizedOpen: Promise<string | null> | null = null;

	constructor(
		private readonly entry: SharedMediaEntry,
		private readonly dependencies: ViewOnceMediaDependencies = defaultDependencies,
	) {}

	open(
		authorize: () => Promise<AuthorizedMedia | null>,
		authorizeIfMissing = true,
	): Promise<string | null> {
		return this.#probeThenOpen(authorize, authorizeIfMissing);
	}

	/** A metadata-only cache lookup. A miss is deliberately never memoized. */
	async probe(): Promise<string | null> {
		const cached = await this.dependencies.lookup(this.entry).catch(() => null);
		return cached?.found ? cached.protocolUrl : null;
	}

	async #probeThenOpen(
		authorize: () => Promise<AuthorizedMedia | null>,
		authorizeIfMissing: boolean,
	): Promise<string | null> {
		const cached = await this.probe();
		if (cached !== null) return cached;
		if (!authorizeIfMissing) return null;
		this.#authorizedOpen ??= this.#authorizeAndRetain(authorize);
		return this.#authorizedOpen;
	}

	async #authorizeAndRetain(
		authorize: () => Promise<AuthorizedMedia | null>,
	): Promise<string | null> {
		const authorized = await authorize();
		if (authorized === null) return null;
		const retainedEntry: SharedMediaEntry = {
			...this.entry,
			remoteAvailability: "available",
			remoteUrl: authorized.url,
		};
		try {
			return (
				(await this.dependencies.retain(
					retainedEntry,
					authorized.contentType,
				)) ?? authorized.url
			);
		} catch {
			return authorized.url;
		}
	}
}

function stableIdentity(entry: SharedMediaEntry): string {
	return JSON.stringify([
		entry.accountProfileId,
		entry.conversationId,
		entry.peerProfileId,
		entry.messageId,
		entry.mediaId,
		entry.kind,
		entry.messageType,
	]);
}

/**
 * Keeps exact-once authorization state stable when reconciliation replaces a
 * message body with an equivalent object. A genuinely different composite
 * media identity receives a fresh resolver.
 */
export class StableExplicitViewOnceMediaSource {
	#identity: string | null = null;
	#source: ExplicitViewOnceMediaSource | null = null;

	constructor(
		private readonly dependencies: ViewOnceMediaDependencies = defaultDependencies,
	) {}

	forEntry(entry: SharedMediaEntry | null): ExplicitViewOnceMediaSource | null {
		if (entry === null) {
			this.#identity = null;
			this.#source = null;
			return null;
		}
		const identity = stableIdentity(entry);
		if (identity !== this.#identity) {
			this.#identity = identity;
			this.#source = new ExplicitViewOnceMediaSource(entry, this.dependencies);
		}
		return this.#source;
	}
}
