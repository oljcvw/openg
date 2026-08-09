import { getAlbumsSharedByProfile } from "$lib/api/messaging/albums";
import {
	type CachedAlbumRecord,
	discoverSharedAlbum,
	listCachedAlbumHistoryPage,
	reconcileCachedAlbumMembership,
} from "$lib/app-data/album-cache";
import type { SharedAlbum } from "$lib/model/messaging/albums";

export type LoadedSharedAlbumCollection = {
	current: SharedAlbum[];
	cached: CachedAlbumRecord[];
	nextCachedCursor: string | null;
};

/**
 * Canonical remote-plus-retained collection loader used by both profile and
 * conversation surfaces. The remote list becomes authoritative only after
 * complete parsing and strict peer validation.
 */
export async function loadSharedAlbumCollection({
	ownerProfileId,
	cursor = null,
}: {
	ownerProfileId: number;
	cursor?: string | null;
}): Promise<LoadedSharedAlbumCollection> {
	const current = await getAlbumsSharedByProfile(ownerProfileId);
	if (current.some((album) => album.profileId !== ownerProfileId))
		throw new Error("Shared-album response contained an unexpected owner");

	await reconcileCachedAlbumMembership(
		ownerProfileId,
		new Set(current.map((album) => album.albumId)),
	);
	for (const album of current) {
		void discoverSharedAlbum({
			albumId: album.albumId,
			ownerProfileId,
			expirationType: album.expirationType,
			expiresAt: album.expiresAt,
			isViewable: album.albumViewable,
			ownerValidated: true,
		});
	}

	const history = await listCachedAlbumHistoryPage(ownerProfileId, cursor);
	const currentIds = new Set(current.map((album) => album.albumId));
	return {
		current,
		cached: history.items.filter(
			(record) => !currentIds.has(record.identity.albumId),
		),
		nextCachedCursor: history.nextCursor,
	};
}

export async function loadSharedAlbumHistoryPage({
	ownerProfileId,
	cursor,
}: {
	ownerProfileId: number;
	cursor: string | null;
}): Promise<{
	items: CachedAlbumRecord[];
	nextCursor: string | null;
}> {
	return await listCachedAlbumHistoryPage(ownerProfileId, cursor);
}
