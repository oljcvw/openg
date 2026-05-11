import { getCascadeV3 } from "$lib/api/grid";
import { getProfiles } from "$lib/api/profile";

export type FullGridProfile = {
	type: "full";
	id: number;
	displayName: string | null;
	distance: number | null;
	profilePhotosHashes: string[] | null;
	unread: number | null;
};

export type PartialGridProfile = {
	type: "partial";
	id: number;
	batchIndex: number;
};

export type GridProfile = FullGridProfile | PartialGridProfile;

export async function getGrid(query: Parameters<typeof getCascadeV3>[0]) {
	const response = await getCascadeV3(query);
	const items: GridProfile[] = [];
	const partialBatches: { batch: { profileId: number }[] }[] = [];
	let currentBatch: { profileId: number }[] = [];

	for (const item of response.items) {
		if (item.type === "full_profile_v1") {
			const profile = item.data;
			items.push({
				type: "full",
				id: profile.profileId,
				displayName: profile.displayName ?? null,
				distance: profile.distanceMeters ?? null,
				profilePhotosHashes: profile.photoMediaHashes,
				unread: profile.unreadCount ?? null,
			});
		} else if (item.type === "partial_profile_v1") {
			if (currentBatch.length === 150) {
				partialBatches.push({ batch: currentBatch });
				currentBatch = [];
			}
			const batchIndex = partialBatches.length;
			currentBatch.push({ profileId: item.data.profileId });
			items.push({
				type: "partial",
				id: item.data.profileId,
				batchIndex,
			});
		}
	}
	if (currentBatch.length > 0) {
		partialBatches.push({ batch: currentBatch });
	}

	return {
		items,
		partialBatches,
		nextPage: response.nextPage,
		shuffled: response.shuffled,
	};
}

export function mergeResolvedGridProfiles({
	items,
	requestedIds,
	resolvedProfiles,
}: {
	items: GridProfile[];
	requestedIds: number[];
	resolvedProfiles: FullGridProfile[];
}) {
	const requested = new Set(requestedIds);
	const resolved = new Map(
		resolvedProfiles.map((profile) => [profile.id, profile]),
	);

	return items.flatMap((item) => {
		const profile = resolved.get(item.id);
		if (profile) return [profile];
		if (requested.has(item.id)) return [];
		return [item];
	});
}
export async function resolvePartialBatch(
	profileIds: number[],
): Promise<FullGridProfile[]> {
	const orderedIds = [...new Set(profileIds)];
	if (orderedIds.length === 0) return [];

	const profileOrder = new Map(
		orderedIds.map((profileId, index) => [profileId, index]),
	);
	const profiles = await getProfiles(orderedIds);
	return profiles
		.filter(({ profileId }) => profileOrder.has(profileId))
		.sort(
			(a, b) => profileOrder.get(a.profileId)! - profileOrder.get(b.profileId)!,
		)
		.map((profile) => ({
			type: "full" as const,
			id: profile.profileId,
			displayName: profile.displayName ?? null,
			distance: profile.distance ?? null,
			profilePhotosHashes: profile.medias?.map((m) => m.mediaHash) ?? null,
			unread: null,
		}));
}
