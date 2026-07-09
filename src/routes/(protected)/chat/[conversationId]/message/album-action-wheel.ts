/**
 * Album action wheel — thin wrapper around the generic RadialActionWheel.
 *
 * Preserves the exact same public API (`createAlbumActionWheel`, `WheelOption`)
 * so consumers in `AlbumMessage.svelte` need no changes.
 */

import {
	createRadialActionWheel,
	type RadialWheelOption,
} from "$lib/components/radial-action-wheel";

export type WheelOption = RadialWheelOption;

/**
 * Build the album-footer action wheel and append it to `container`.
 * Returns a cleanup function that removes listeners and DOM.
 */
export function createAlbumActionWheel(
	container: HTMLElement,
	options: WheelOption[],
): () => void {
	return createRadialActionWheel(container, options, {
		radius: 140,
		safeZoneRadius: 24,
		arcDegrees: 90,
		classPrefix: "pswp__chat-album-footer",
	});
}