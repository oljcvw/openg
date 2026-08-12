export type ProfileNavigationDirection = "next" | "previous";

export type AdjacentProfileIds = {
	nextProfileId: number | null;
	previousProfileId: number | null;
};

type SwipeSelection = {
	direction: ProfileNavigationDirection;
	profileId: number | null;
};

export function getUniqueProfileIds(
	profiles: readonly { id: number }[],
): number[] {
	const seen = new Set<number>();
	const profileIds: number[] = [];

	for (const profile of profiles) {
		if (seen.has(profile.id)) continue;
		seen.add(profile.id);
		profileIds.push(profile.id);
	}

	return profileIds;
}

export function getAdjacentProfileIds(
	profiles: readonly { id: number }[],
	profileId: number,
): AdjacentProfileIds {
	const profileIds = getUniqueProfileIds(profiles);
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

export function selectProfileForHorizontalSwipe({
	deltaX,
	deltaY,
	elapsedMs,
	nextProfileId,
	previousProfileId,
	startX,
	edgeBackWidth = 24,
	distanceThreshold = 80,
	velocityThreshold = 0.55,
	minimumFlickDistance = 32,
	axisRatio = 1.35,
}: AdjacentProfileIds & {
	deltaX: number;
	deltaY: number;
	elapsedMs: number;
	startX: number;
	edgeBackWidth?: number;
	distanceThreshold?: number;
	velocityThreshold?: number;
	minimumFlickDistance?: number;
	axisRatio?: number;
}): SwipeSelection | null {
	const absX = Math.abs(deltaX);
	const absY = Math.abs(deltaY);
	const velocity = absX / Math.max(elapsedMs, 1);

	if (startX <= edgeBackWidth) return null;
	if (absX <= absY * axisRatio) return null;
	if (
		absX < distanceThreshold &&
		(absX < minimumFlickDistance || velocity < velocityThreshold)
	)
		return null;

	const direction = deltaX < 0 ? "next" : "previous";
	return {
		direction,
		profileId: direction === "next" ? nextProfileId : previousProfileId,
	};
}

export function selectProfileForNavigationKey({
	canNavigateNext,
	canNavigatePrevious,
	enabled,
	key,
}: {
	canNavigateNext: boolean;
	canNavigatePrevious: boolean;
	enabled: boolean;
	key: string;
}): ProfileNavigationDirection | null {
	if (!enabled) return null;
	if (key === "ArrowLeft" && canNavigatePrevious) return "previous";
	if (key === "ArrowRight" && canNavigateNext) return "next";
	return null;
}

export function isProfileSwipeInteractiveTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) return false;
	if (target.closest("[data-profile-swipe-surface]")) return false;
	return Boolean(
		target.closest(
			[
				"a",
				"button",
				"input",
				"select",
				"textarea",
				"[contenteditable='true']",
				"[role='button']",
				"[role='dialog']",
				"[data-profile-swipe-ignore]",
				".pswp",
			].join(","),
		),
	);
}
