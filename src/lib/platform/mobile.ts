export type AppPlatform = string;

export type PlatformFlags = {
	current: AppPlatform;
	isAndroid: boolean;
	isIos: boolean;
	isMobile: boolean;
};

export function getPlatformFlags(current: AppPlatform): PlatformFlags {
	const isAndroid = current === "android";
	const isIos = current === "ios";

	return {
		current,
		isAndroid,
		isIos,
		isMobile: isAndroid || isIos,
	};
}

export function applyPlatformAttributes(
	element: HTMLElement,
	flags: PlatformFlags,
): void {
	element.dataset.platform = flags.current;
	element.dataset.mobilePlatform = String(flags.isMobile);
	element.dataset.androidPlatform = String(flags.isAndroid);
}
