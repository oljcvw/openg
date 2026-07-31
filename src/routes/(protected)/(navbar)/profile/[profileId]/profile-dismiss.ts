type ProfileDismissAnimation = {
	finished: Promise<unknown>;
};

export async function waitForProfileDismissAnimations(
	getAnimations: () => readonly ProfileDismissAnimation[],
): Promise<void> {
	const animations = getAnimations();
	if (animations.length === 0) return;

	await Promise.allSettled(animations.map(({ finished }) => finished));
}
