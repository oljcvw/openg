import {
	elementScroll,
	measureElement,
	observeElementOffset,
	observeElementRect,
	type Rect,
	type VirtualizerOptions,
} from "@tanstack/svelte-virtual";

import type { ScrollNeighborhood } from "$lib/navigation/navigation-memory";

export const CONVERSATION_ROW_ESTIMATE_PX = 102;
export const CONVERSATION_LIST_OVERSCAN = 6;

export function conversationListVirtualizerOptions(
	conversationIds: readonly string[],
	getScrollElement: () => HTMLElement | null,
	initialRect?: Rect,
): VirtualizerOptions<HTMLElement, HTMLElement> {
	return {
		count: conversationIds.length,
		getScrollElement,
		estimateSize: () => CONVERSATION_ROW_ESTIMATE_PX,
		getItemKey: (index) => conversationIds[index] ?? index,
		measureElement,
		overscan: CONVERSATION_LIST_OVERSCAN,
		initialRect: initialRect ?? { width: 420, height: 800 },
		observeElementRect,
		observeElementOffset,
		scrollToFn: elementScroll,
		useAnimationFrameWithResizeObserver: true,
	};
}

export function resolveConversationRestoreTarget(
	conversationIds: readonly string[],
	anchorItemKey: string,
	neighborhood?: ScrollNeighborhood | null,
): { index: number; itemKey: string } | null {
	const exactIndex = conversationIds.indexOf(anchorItemKey);
	if (exactIndex !== -1)
		return { index: exactIndex, itemKey: conversationIds[exactIndex] };
	if (!neighborhood) return null;

	for (
		let distance = 1;
		distance < neighborhood.orderedItemKeys.length;
		distance += 1
	) {
		for (const neighborhoodIndex of [
			neighborhood.anchorIndex - distance,
			neighborhood.anchorIndex + distance,
		]) {
			const itemKey = neighborhood.orderedItemKeys[neighborhoodIndex];
			if (!itemKey) continue;
			const index = conversationIds.indexOf(itemKey);
			if (index !== -1) return { index, itemKey };
		}
	}
	return null;
}
