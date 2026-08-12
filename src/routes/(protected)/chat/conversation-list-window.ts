import {
	elementScroll,
	measureElement,
	observeElementOffset,
	observeElementRect,
	type Rect,
	type VirtualizerOptions,
} from "@tanstack/svelte-virtual";

import type { InboxRowDensity } from "$lib/app-data/preferences.svelte";
import type { ScrollNeighborhood } from "$lib/navigation/navigation-memory";

export const CONVERSATION_ROW_ESTIMATE_PX = 104;
export const CONVERSATION_LIST_OVERSCAN = 6;

const INBOX_ROW_ESTIMATE_PX: Record<InboxRowDensity, number> = {
	compact: 80,
	comfortable: CONVERSATION_ROW_ESTIMATE_PX,
	roomy: 128,
};

export function inboxRowEstimatePx(density: InboxRowDensity): number {
	return INBOX_ROW_ESTIMATE_PX[density];
}

export function resolveInboxLayoutKind(
	mode: import("$lib/app-data/preferences.svelte").InboxLayoutMode,
	belowSplitBreakpoint: boolean,
): "split" | "stacked" {
	return mode === "adaptive" && !belowSplitBreakpoint ? "split" : "stacked";
}

export function conversationListVirtualizerOptions(
	conversationIds: readonly string[],
	getScrollElement: () => HTMLElement | null,
	initialRect?: Rect,
	density: InboxRowDensity = "comfortable",
): VirtualizerOptions<HTMLElement, HTMLElement> {
	const rowEstimate = inboxRowEstimatePx(density);
	return {
		count: conversationIds.length,
		getScrollElement,
		estimateSize: () => rowEstimate,
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

export type ConversationVirtualRow = {
	index: number;
	key: string;
	lane: number;
	start: number;
	end: number;
	size: number;
};

export function fallbackConversationVirtualRows({
	conversationIds,
	scrollOffset,
	viewportHeight,
	rowEstimate,
}: {
	conversationIds: readonly string[];
	scrollOffset: number;
	viewportHeight: number;
	rowEstimate: number;
}): ConversationVirtualRow[] {
	if (conversationIds.length === 0) return [];
	const visibleStart = Math.floor(Math.max(0, scrollOffset) / rowEstimate);
	const start = Math.max(0, visibleStart - CONVERSATION_LIST_OVERSCAN);
	const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowEstimate));
	const end = Math.min(
		conversationIds.length,
		start + visibleCount + CONVERSATION_LIST_OVERSCAN * 2,
	);
	return conversationIds.slice(start, end).map((conversationId, offset) => {
		const index = start + offset;
		return {
			index,
			key: conversationId,
			lane: 0,
			start: index * rowEstimate,
			end: (index + 1) * rowEstimate,
			size: rowEstimate,
		};
	});
}

export function shouldLoadMoreConversations(
	renderedRows: readonly { index: number }[],
	conversationCount: number,
	threshold = CONVERSATION_LIST_OVERSCAN,
): boolean {
	if (conversationCount === 0 || renderedRows.length === 0) return false;
	const lastIndex = renderedRows.reduce(
		(maximum, row) => Math.max(maximum, row.index),
		-1,
	);
	return lastIndex >= conversationCount - 1 - threshold;
}

export function resolveConversationRestoreTarget(
	conversationIds: readonly string[],
	anchorItemKey: string,
	neighborhood?: ScrollNeighborhood | null,
): { index: number; itemKey: string } | null {
	const exactIndex = conversationIds.indexOf(anchorItemKey);
	if (exactIndex !== -1)
		return { index: exactIndex, itemKey: conversationIds[exactIndex]! };
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
