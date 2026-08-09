import { describe, expect, it } from "vitest";

import {
	reconcileSharedAlbumCollection,
	type RetainedSharedAlbum,
	SharedAlbumCollection,
} from "$lib/chat/shared-albums";
import type { SharedAlbum } from "$lib/model/messaging/albums";

function remote(albumId: number, profileId = 42): SharedAlbum {
	return {
		albumId,
		albumName: `Album ${albumId}`,
		profileId,
		albumViewable: true,
		hasUnseenContent: false,
		expiresAt: null,
		expirationType: "INDEFINITE",
		content: null,
		contentCount: { imageCount: albumId, videoCount: 0 },
	};
}

function retained(
	albumId: number,
	isCurrentlyShared = true,
): RetainedSharedAlbum {
	return {
		identity: { accountProfileId: 7, ownerProfileId: 42, albumId },
		albumName: `Album ${albumId}`,
		coverUrl: null,
		itemCount: albumId,
		hasUnseenContent: false,
		membership: {
			isCurrentlyShared,
			lastListedAt: 100,
			unavailableReason: isCurrentlyShared ? null : "unshared",
		},
		lastAccessedAt: 100,
	};
}

describe("shared-album collection reconciliation", () => {
	it("moves absent current albums to history and adds newly shared albums", () => {
		const first = reconcileSharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			remoteAlbums: [remote(1)],
			retainedAlbums: [retained(1), retained(2)],
			now: 200,
		});

		expect(first.current.map((entry) => entry.identity.albumId)).toEqual([1]);
		expect(first.cached.map((entry) => entry.identity.albumId)).toEqual([2]);
		expect(first.cached[0].membership).toMatchObject({
			isCurrentlyShared: false,
			unavailableReason: "unshared",
		});

		const second = reconcileSharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			remoteAlbums: [remote(1), remote(3)],
			retainedAlbums: [...first.current, ...first.cached],
			now: 300,
		});
		expect(second.current.map((entry) => entry.identity.albumId)).toEqual([
			1, 3,
		]);
		expect(second.cached.map((entry) => entry.identity.albumId)).toEqual([2]);
	});

	it("rejects records attributed to a different owner", () => {
		expect(() =>
			reconcileSharedAlbumCollection({
				accountProfileId: 7,
				ownerProfileId: 42,
				remoteAlbums: [remote(1, 99)],
				retainedAlbums: [],
				now: 200,
			}),
		).toThrow("owner");
	});

	it("keeps colliding album ids isolated by account and owner", () => {
		const result = reconcileSharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			remoteAlbums: [remote(1)],
			retainedAlbums: [
				retained(1, false),
				{
					...retained(1, false),
					identity: { accountProfileId: 8, ownerProfileId: 42, albumId: 1 },
				},
				{
					...retained(1, false),
					identity: { accountProfileId: 7, ownerProfileId: 99, albumId: 1 },
				},
			],
			now: 200,
		});

		expect(result.current).toHaveLength(1);
		expect(result.cached).toHaveLength(0);
	});

	it("retains arbitrary history while returning one requested page", () => {
		const retainedAlbums = Array.from({ length: 1_000 }, (_, index) => ({
			...retained(index + 1, false),
			lastAccessedAt: index,
		}));
		const result = reconcileSharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			remoteAlbums: [],
			retainedAlbums,
			now: 2_000,
			page: { offset: 60, limit: 60 },
		});

		expect(result.cached).toHaveLength(60);
		expect(result.cachedTotal).toBe(1_000);
		expect(result.nextCachedOffset).toBe(120);
	});
});

describe("SharedAlbumCollection authoritative refresh", () => {
	it("does not change membership after a failed refresh", async () => {
		const existing = retained(1, true);
		const collection = new SharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			loadCurrent: () => Promise.reject(new Error("offline")),
			loadHistory: () =>
				Promise.resolve({ items: [existing], nextCursor: null }),
			commitCurrentMembership: () =>
				Promise.reject(new Error("must not commit")),
		});

		await collection.loadCachedPage(null);
		await collection.refresh();
		expect(collection.status).toBe("error");
		expect(collection.current).toEqual([]);
		expect(collection.cached[0].membership.isCurrentlyShared).toBe(true);
	});

	it("commits the complete validated current set only after successful parsing", async () => {
		let committed: ReadonlySet<number> | null = null;
		const collection = new SharedAlbumCollection({
			accountProfileId: 7,
			ownerProfileId: 42,
			loadCurrent: () => Promise.resolve([remote(1), remote(3)]),
			loadHistory: () =>
				Promise.resolve({
					items: [retained(2, true)],
					nextCursor: null,
				}),
			commitCurrentMembership: (ids) => {
				committed = ids;
				return Promise.resolve();
			},
		});

		await collection.loadCachedPage(null);
		await collection.refresh();
		expect([...committed!]).toEqual([1, 3]);
		expect(collection.current.map((entry) => entry.identity.albumId)).toEqual([
			1, 3,
		]);
		expect(collection.lastSuccessfulRefreshAt).not.toBeNull();
	});
});
