export type AdjacentProfileIds = {
	nextProfileId: number | null;
	previousProfileId: number | null;
};

export function getUniqueGridProfiles<T extends { id: number }>(
	profiles: readonly T[],
): T[] {
	const seen = new Set<number>();
	const uniqueProfiles: T[] = [];

	for (const profile of profiles) {
		if (seen.has(profile.id)) continue;
		seen.add(profile.id);
		uniqueProfiles.push(profile);
	}

	return uniqueProfiles;
}

export function getAdjacentProfileIds(
	profiles: readonly { id: number }[],
	profileId: number,
): AdjacentProfileIds {
	const profileIds = getUniqueGridProfiles(profiles).map(({ id }) => id);
	const profileIndex = profileIds.indexOf(profileId);

	if (profileIndex === -1) {
		return {
			nextProfileId: null,
			previousProfileId: null,
		};
	}

	return {
		nextProfileId: profileIds[profileIndex + 1] ?? null,
		previousProfileId: profileIds[profileIndex - 1] ?? null,
	};
}

export function selectProfileIdForHorizontalSwipe({
	deltaX,
	deltaY,
	nextProfileId,
	previousProfileId,
	threshold = 80,
}: AdjacentProfileIds & {
	deltaX: number;
	deltaY: number;
	threshold?: number;
}): number | null {
	const absX = Math.abs(deltaX);
	const absY = Math.abs(deltaY);

	if (absX < threshold || absX <= absY * 1.5) return null;

	return deltaX < 0 ? nextProfileId : previousProfileId;
}
