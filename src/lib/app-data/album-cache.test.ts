import { describe, expect, it } from "vitest";

import {
	advanceAlbumMigrationProgress,
	AlbumHistoryCursorRegistry,
	albumHistoryCursorScopeKey,
	AlbumHistoryPageCache,
	albumIdentityKey,
	classifyDiscoveryAccess,
	compareAlbumHistoryOrder,
	contentFingerprint,
	migrateBeta4AlbumRecord,
	ownerlessLegacyMatchesValidatedIdentity,
	ownerScopedAlbumMigrationRecords,
	pageAlbumHistoryRecords,
	reconcileAlbumMembership,
	reconcileRetainedItems,
} from "$lib/app-data/album-cache";

describe("bounded album history memory", () => {
	it("keeps only three pages per account-owner while identities collide", () => {
		const cache = new AlbumHistoryPageCache<number>(3);
		cache.set(1, 2, null, [1]);
		cache.set(1, 2, "page-2", [2]);
		cache.set(1, 2, "page-3", [3]);
		cache.set(9, 2, null, [90]);
		cache.set(1, 4, null, [40]);
		cache.set(1, 2, "page-4", [4]);

		expect(cache.get(1, 2, null)).toBeNull();
		expect(cache.get(1, 2, "page-2")).toEqual([2]);
		expect(cache.get(1, 2, "page-4")).toEqual([4]);
		expect(cache.get(9, 2, null)).toEqual([90]);
		expect(cache.get(1, 4, null)).toEqual([40]);
	});

	it("bounds and explicitly closes legacy cursor state", () => {
		let now = 1_000;
		const cursors = new AlbumHistoryCursorRegistry<number>({
			capacity: 2,
			ttlMs: 100,
			now: () => now,
		});
		cursors.set("one", 1, 2, 1);
		cursors.set("two", 1, 2, 2);
		cursors.set("three", 1, 2, 3);

		expect(cursors.take("one", 1, 2)).toBeNull();
		expect(cursors.take("two", 9, 2)).toBeNull();
		expect(cursors.take("two", 1, 2)).toBe(2);
		now += 101;
		expect(cursors.take("three", 1, 2)).toBeNull();

		cursors.set("four", 1, 2, 4);
		cursors.closeOwner(1, 2);
		expect(cursors.take("four", 1, 2)).toBeNull();
	});
});

describe("album access classification", () => {
	it("keeps a currently viewable album active", () => {
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, isViewable: true },
				1_000,
			),
		).toBeNull();
	});

	it("distinguishes expiry from exhausted views", () => {
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, expiresAt: 999 },
				1_000,
			),
		).toMatchObject({ status: "unavailable", reason: "expired" });
		expect(
			classifyDiscoveryAccess(
				{ albumId: 1, ownerProfileId: 2, isViewable: false },
				1_000,
			),
		).toMatchObject({ status: "unavailable", reason: "views_exhausted" });
	});
});

describe("album cache composite identity", () => {
	it("isolates accounts and owners even when album ids collide", () => {
		expect(
			albumIdentityKey({ accountProfileId: 1, ownerProfileId: 2, albumId: 3 }),
		).not.toBe(
			albumIdentityKey({ accountProfileId: 1, ownerProfileId: 4, albumId: 3 }),
		);
		expect(
			albumIdentityKey({ accountProfileId: 1, ownerProfileId: 2, albumId: 3 }),
		).not.toBe(
			albumIdentityKey({ accountProfileId: 9, ownerProfileId: 2, albumId: 3 }),
		);
	});

	it("scopes opaque native history cursors by account and owner", () => {
		expect(albumHistoryCursorScopeKey(1, 2, "same-cursor")).not.toBe(
			albumHistoryCursorScopeKey(1, 3, "same-cursor"),
		);
		expect(albumHistoryCursorScopeKey(1, 2, "same-cursor")).not.toBe(
			albumHistoryCursorScopeKey(9, 2, "same-cursor"),
		);
		expect(albumHistoryCursorScopeKey(1, 2, "same-cursor")).toBe(
			albumHistoryCursorScopeKey(1, 2, "same-cursor"),
		);
	});

	it("binds an ownerless legacy record only after exact album proof", () => {
		const identity = {
			accountProfileId: 1,
			ownerProfileId: 2,
			albumId: 3,
		};
		expect(
			ownerlessLegacyMatchesValidatedIdentity(
				{ albumId: 3, ownerProfileId: null },
				identity,
			),
		).toBe(true);
		expect(
			ownerlessLegacyMatchesValidatedIdentity(
				{ albumId: 4, ownerProfileId: null },
				identity,
			),
		).toBe(false);
		expect(
			ownerlessLegacyMatchesValidatedIdentity(
				{ albumId: 3, ownerProfileId: 9 },
				identity,
			),
		).toBe(false);
	});

	it("fingerprints stable ordered content identity without URLs", () => {
		const first = contentFingerprint([
			{ contentId: 1, contentType: "image/jpeg" },
			{ contentId: 2, contentType: "video/mp4" },
		]);
		expect(first).toBe(
			contentFingerprint([
				{ contentId: 1, contentType: "image/jpeg", url: "https://one" },
				{ contentId: 2, contentType: "video/mp4", url: "https://two" },
			]),
		);
		expect(first).not.toBe(
			contentFingerprint([
				{ contentId: 2, contentType: "video/mp4" },
				{ contentId: 1, contentType: "image/jpeg" },
			]),
		);
	});

	it("retains removed items while updating current order", () => {
		const retained = reconcileRetainedItems(
			[
				{
					contentId: 1,
					contentType: "image/jpeg",
					firstSeenAt: 10,
					lastSeenAt: 10,
					removedAt: null,
					cacheToken: "opaque",
					byteLength: 5,
				},
			],
			[{ contentId: 2, contentType: "video/mp4" }],
			20,
		);
		expect(retained).toEqual([
			expect.objectContaining({
				contentId: 1,
				removedAt: 20,
				cacheToken: "opaque",
			}),
			expect.objectContaining({
				contentId: 2,
				removedAt: null,
				firstSeenAt: 20,
			}),
		]);
	});

	it("pages large history in stable groups of sixty without a product cap", () => {
		const records = Array.from({ length: 1_000 }, (_, index) => ({
			albumId: 1_000 - index,
			lastAccessedAt: 10_000 - index,
		}));
		const first = pageAlbumHistoryRecords(records, 0);
		const last = pageAlbumHistoryRecords(records, 960);
		expect(first.items).toHaveLength(60);
		expect(first.nextOffset).toBe(60);
		expect(last.items).toHaveLength(40);
		expect(last.nextOffset).toBeNull();
		expect(first.items[0]?.albumId).toBe(1_000);
	});

	it("finds requested-owner beta-4 records beyond the first global batch", () => {
		const mixed = [
			...Array.from({ length: 1_000 }, (_, albumId) => ({
				albumId,
				identity: { ownerProfileId: 10 },
			})),
			...Array.from({ length: 125 }, (_, albumId) => ({
				albumId: albumId + 2_000,
				identity: { ownerProfileId: 20 },
			})),
		];

		const requested = ownerScopedAlbumMigrationRecords(mixed, 20);
		expect(requested).toHaveLength(125);
		expect(pageAlbumHistoryRecords(requested, 0).items).toHaveLength(60);
	});

	it("resumes more than 120 beta-4 albums in bounded sixty-record steps", () => {
		const keys = Array.from(
			{ length: 125 },
			(_, index) => `album-${String(index).padStart(3, "0")}`,
		);
		let progress = { cursor: null as string | null, complete: false };
		let steps = 0;
		while (!progress.complete) {
			const remaining = keys.filter(
				(key) => progress.cursor === null || key > progress.cursor,
			);
			const page = remaining.slice(0, 60);
			expect(page.length).toBeLessThanOrEqual(60);
			progress = advanceAlbumMigrationProgress(
				progress.cursor,
				page,
				remaining.length > page.length ? page.at(-1)! : null,
				true,
			);
			steps += 1;
		}
		expect(steps).toBe(3);
		expect(progress.cursor).toBe("album-124");
	});

	it("applies the last authoritative membership to albums migrated after two pages", () => {
		const membership = {
			version: 5 as const,
			currentAlbumIds: [1],
			listedAt: 50_000,
		};
		const migrated = Array.from({ length: 125 }, (_, index) => {
			const albumId = index + 1;
			return migrateBeta4AlbumRecord(
				{ accountProfileId: 7, ownerProfileId: 42, albumId },
				{
					version: 1,
					albumId,
					ownerProfileId: 42,
					expirationType: null,
					expiresAt: null,
					access: { status: "active", validatedAt: 10 },
					album: {
						albumId,
						albumName: `Album ${albumId}`,
						profileId: 42,
						albumViewable: true,
						hasUnseenContent: false,
						sharedCount: 1,
						createdAt: "2026-01-01T00:00:00Z",
						updatedAt: "2026-01-01T00:00:00Z",
						content: [],
					},
					media: [],
					lastAccessedAt: index === 120 ? 100_000 : 10,
				},
				membership,
				{ source: "beta4", sequence: index },
			);
		});

		expect(migrated[0]?.membership).toEqual({
			isCurrentlyShared: true,
			lastListedAt: 50_000,
			unavailableReason: null,
		});
		expect(migrated[120]?.membership).toEqual({
			isCurrentlyShared: false,
			lastListedAt: 50_000,
			unavailableReason: "unshared",
		});
		expect(migrated.toSorted(compareAlbumHistoryOrder)[120]?.albumId).toBe(121);
		expect(migrated[120]?.historyOrder).toEqual({
			source: "beta4",
			sequence: 120,
		});
	});

	it("moves absent shares to history without conflating later albums", () => {
		const existing = [
			{
				albumId: 1,
				membership: {
					isCurrentlyShared: true,
					lastListedAt: 1,
					unavailableReason: null,
				},
			},
			{
				albumId: 2,
				membership: {
					isCurrentlyShared: true,
					lastListedAt: 1,
					unavailableReason: null,
				},
			},
		];
		const afterRetraction = reconcileAlbumMembership(existing, new Set([1]), 2);
		expect(
			afterRetraction.map((item) => [
				item.albumId,
				item.membership.isCurrentlyShared,
			]),
		).toEqual([
			[1, true],
			[2, false],
		]);
		const afterNewShare = reconcileAlbumMembership(
			[
				...afterRetraction,
				{
					albumId: 3,
					membership: {
						isCurrentlyShared: true,
						lastListedAt: 3,
						unavailableReason: null,
					},
				},
			],
			new Set([1, 3]),
			4,
		);
		expect(
			afterNewShare.find((item) => item.albumId === 2)?.membership
				.unavailableReason,
		).toBe("unshared");
	});
});
