let activeMedia: HTMLMediaElement | null = null;

export function activateMedia(element: HTMLMediaElement): void {
	if (activeMedia && activeMedia !== element) activeMedia.pause();
	activeMedia = element;
}

export function releaseMedia(element: HTMLMediaElement): void {
	if (activeMedia === element) activeMedia = null;
}

export function disposeMedia(element: HTMLMediaElement): void {
	element.pause();
	releaseMedia(element);
	element.removeAttribute("src");
	element.load();
}
