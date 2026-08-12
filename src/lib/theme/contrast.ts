import type { ContrastMode } from "$lib/app-data/preferences.svelte";

export function applyContrastMode(mode: ContrastMode): void {
	if (mode === "high") {
		document.documentElement.dataset.contrast = "high";
		return;
	}
	delete document.documentElement.dataset.contrast;
}
