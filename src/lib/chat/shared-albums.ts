import type { SharedAlbum } from "$lib/model/messaging/albums";

export type SharedAlbumIdentity = {
	accountProfileId: number;
	ownerProfileId: number;
	albumId: number;
};

export type SharedAlbumUnavailableReason =
	| "unshared"
	| "expired"
	| "views_exhausted"
	| "deleted";

export type RetainedSharedAlbum = {
	identity: SharedAlbumIdentity;
	albumName: string | null;
	coverUrl: string | null;
	itemCount: number | null;
	hasUnseenContent: boolean;
	membership: {
		isCurrentlyShared: boolean;
		lastListedAt: number;
		unavailableReason: SharedAlbumUnavailableReason | null;
	};
	lastAccessedAt: number;
};

export type SharedAlbumCollectionPage = {
	current: RetainedSharedAlbum[];
	cached: RetainedSharedAlbum[];
	cachedTotal: number;
	nextCachedOffset: number | null;
};

export type SharedAlbumCollectionStatus = "loading" | "ready" | "error";

export class SharedAlbumCollection {
	status: SharedAlbumCollectionStatus = "loading";
	current: RetainedSharedAlbum[] = [];
	cached: RetainedSharedAlbum[] = [];
	nextCachedCursor: string | null = null;
	lastSuccessfulRefreshAt: number | null = null;
	error: unknown | null = null;

	readonly #accountProfileId: number;
	readonly #ownerProfileId: number;
	readonly #loadCurrent: () => Promise<SharedAlbum[]>;
	readonly #loadHistory: (
		cursor: string | null,
	) => Promise<{ items: RetainedSharedAlbum[]; nextCursor: string | null }>;
	readonly #commitCurrentMembership: (
		albumIds: ReadonlySet<number>,
		listedAt: number,
	) => Promise<void>;
	readonly #releaseHistory: () => void | Promise<void>;
	#generation = 0;

	constructor(options: {
		accountProfileId: number;
		ownerProfileId: number;
		loadCurrent: () => Promise<SharedAlbum[]>;
		loadHistory: (
			cursor: string | null,
		) => Promise<{ items: RetainedSharedAlbum[]; nextCursor: string | null }>;
		commitCurrentMembership: (
			albumIds: ReadonlySet<number>,
			listedAt: number,
		) => Promise<void>;
		releaseHistory?: () => void | Promise<void>;
	}) {
		this.#accountProfileId = options.accountProfileId;
		this.#ownerProfileId = options.ownerProfileId;
		this.#loadCurrent = options.loadCurrent;
		this.#loadHistory = options.loadHistory;
		this.#commitCurrentMembership = options.commitCurrentMembership;
		this.#releaseHistory = options.releaseHistory ?? (() => {});
	}

	async loadCachedPage(cursor: string | null): Promise<void> {
		const generation = this.#generation;
		const page = await this.#loadHistory(cursor);
		if (generation !== this.#generation) return;
		this.cached = page.items.filter((entry) =>
			sameScope(entry, this.#accountProfileId, this.#ownerProfileId),
		);
		this.nextCachedCursor = page.nextCursor;
	}

	async refresh(): Promise<void> {
		const generation = ++this.#generation;
		await this.#releaseHistory();
		if (generation !== this.#generation) return;
		this.status = "loading";
		this.error = null;
		try {
			const remote = await this.#loadCurrent();
			// Parse/ownership validation happens before authoritative membership is
			// committed. A single mismatched record rejects the entire response.
			const now = Date.now();
			const reconciled = reconcileSharedAlbumCollection({
				accountProfileId: this.#accountProfileId,
				ownerProfileId: this.#ownerProfileId,
				remoteAlbums: remote,
				retainedAlbums: [...this.current, ...this.cached],
				now,
			});
			if (generation !== this.#generation) return;
			const ids = new Set(
				reconciled.current.map((entry) => entry.identity.albumId),
			);
			await this.#commitCurrentMembership(ids, now);
			if (generation !== this.#generation) return;
			this.current = reconciled.current;
			this.cached = reconciled.cached;
			this.lastSuccessfulRefreshAt = now;
			this.status = "ready";
		} catch (error) {
			if (generation !== this.#generation) return;
			this.error = error;
			this.status = "error";
		}
	}

	invalidate(): void {
		this.#generation += 1;
	}

	close(): void {
		this.invalidate();
		this.cached = [];
		this.nextCachedCursor = null;
		void this.#releaseHistory();
	}
}

function sameScope(
	entry: RetainedSharedAlbum,
	accountProfileId: number,
	ownerProfileId: number,
): boolean {
	return (
		entry.identity.accountProfileId === accountProfileId &&
		entry.identity.ownerProfileId === ownerProfileId
	);
}

function fromRemote(
	accountProfileId: number,
	ownerProfileId: number,
	album: SharedAlbum,
	now: number,
	previous?: RetainedSharedAlbum,
): RetainedSharedAlbum {
	if (album.profileId !== ownerProfileId) {
		throw new Error("Shared album owner does not match requested profile");
	}
	const count = album.contentCount;
	return {
		identity: { accountProfileId, ownerProfileId, albumId: album.albumId },
		albumName: album.albumName,
		coverUrl: album.content?.coverUrl ?? previous?.coverUrl ?? null,
		itemCount: count
			? count.imageCount + count.videoCount
			: (previous?.itemCount ?? null),
		hasUnseenContent: album.hasUnseenContent,
		membership: {
			isCurrentlyShared: true,
			lastListedAt: now,
			unavailableReason: album.albumViewable ? null : "views_exhausted",
		},
		lastAccessedAt: previous?.lastAccessedAt ?? now,
	};
}

export function reconcileSharedAlbumCollection({
	accountProfileId,
	ownerProfileId,
	remoteAlbums,
	retainedAlbums,
	now = Date.now(),
	page = { offset: 0, limit: 60 },
}: {
	accountProfileId: number;
	ownerProfileId: number;
	remoteAlbums: readonly SharedAlbum[];
	retainedAlbums: readonly RetainedSharedAlbum[];
	now?: number;
	page?: { offset: number; limit: number };
}): SharedAlbumCollectionPage {
	const scoped = retainedAlbums.filter((entry) =>
		sameScope(entry, accountProfileId, ownerProfileId),
	);
	const retainedById = new Map(
		scoped.map((entry) => [entry.identity.albumId, entry]),
	);
	const current = remoteAlbums.map((album) =>
		fromRemote(
			accountProfileId,
			ownerProfileId,
			album,
			now,
			retainedById.get(album.albumId),
		),
	);
	const remoteIds = new Set(current.map((entry) => entry.identity.albumId));
	const cachedAll = scoped
		.filter((entry) => !remoteIds.has(entry.identity.albumId))
		.map((entry) => ({
			...entry,
			membership: {
				isCurrentlyShared: false,
				lastListedAt: now,
				unavailableReason:
					entry.membership.unavailableReason ?? ("unshared" as const),
			},
		}))
		.toSorted((left, right) => right.lastAccessedAt - left.lastAccessedAt);
	const offset = Math.max(0, page.offset);
	const limit = Math.max(1, page.limit);
	const cached = cachedAll.slice(offset, offset + limit);
	return {
		current,
		cached,
		cachedTotal: cachedAll.length,
		nextCachedOffset:
			offset + cached.length < cachedAll.length ? offset + cached.length : null,
	};
}
