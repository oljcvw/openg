import {
	type AccountSessionSnapshot,
	isAccountSessionCurrent,
	registerAccountCache,
} from "$lib/api/account-caches";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";

export const NAVIGATION_MEMORY_DRAFT_CAPACITY = 20;
export const NAVIGATION_MEMORY_CONVERSATION_CAPACITY = 20;

export type NavigationMemorySurface =
	| "browse"
	| "rightNow"
	| "interestViews"
	| "interestTaps"
	| "inboxChats"
	| "inboxAlbums"
	| "chatConversation"
	| "settings";

export type ScrollAnchor = {
	itemKey: string;
	offsetPx: number;
	fallbackOffsetPx: number;
	capturedAt: number;
};

export type ConversationScrollAnchor = ScrollAnchor & {
	distanceFromEndPx: number;
};

export type ScrollNeighborhood = {
	orderedItemKeys: string[];
	anchorIndex: number;
};

export type SurfaceScrollPosition = {
	anchor: ScrollAnchor;
	neighborhood: ScrollNeighborhood | null;
	contentGeneration: number | null;
};

export type DetailSessionState = {
	scrollAnchor: ConversationScrollAnchor | null;
	scrollNeighborhood: ScrollNeighborhood | null;
	draftText: string;
	replyTargetMessageId: string | null;
};

type DraftState = Pick<
	DetailSessionState,
	"draftText" | "replyTargetMessageId"
>;

const EMPTY_DETAIL_SESSION: DetailSessionState = {
	scrollAnchor: null,
	scrollNeighborhood: null,
	draftText: "",
	replyTargetMessageId: null,
};

function copyAnchor<T extends ScrollAnchor>(anchor: T): T {
	return { ...anchor };
}

function copyNeighborhood(
	neighborhood: ScrollNeighborhood | null | undefined,
): ScrollNeighborhood | null {
	return neighborhood
		? {
				orderedItemKeys: [...neighborhood.orderedItemKeys],
				anchorIndex: neighborhood.anchorIndex,
			}
		: null;
}

export class NavigationMemory {
	#surfaceAnchors = new Map<NavigationMemorySurface, ScrollAnchor>();
	#surfaceNeighborhoods = new Map<
		NavigationMemorySurface,
		ScrollNeighborhood
	>();
	#surfaceGenerations = new Map<NavigationMemorySurface, number>();
	#conversationAnchors = new Map<string, ConversationScrollAnchor>();
	#conversationNeighborhoods = new Map<string, ScrollNeighborhood>();
	#drafts = new Map<string, DraftState>();

	clear(): void {
		this.#surfaceAnchors.clear();
		this.#surfaceNeighborhoods.clear();
		this.#surfaceGenerations.clear();
		this.#conversationAnchors.clear();
		this.#conversationNeighborhoods.clear();
		this.#drafts.clear();
	}

	getSurfaceScrollPosition(
		surface: NavigationMemorySurface,
		session: AccountSessionSnapshot,
	): SurfaceScrollPosition | null {
		const anchor = this.getSurfaceAnchor(surface, session);
		if (!anchor) return null;
		return {
			anchor,
			neighborhood: copyNeighborhood(this.#surfaceNeighborhoods.get(surface)),
			contentGeneration: this.#surfaceGenerations.get(surface) ?? null,
		};
	}

	getSurfaceAnchor(
		surface: NavigationMemorySurface,
		session: AccountSessionSnapshot,
	): ScrollAnchor | null {
		if (!isAccountSessionCurrent(session)) return null;
		const anchor = this.#surfaceAnchors.get(surface);
		return anchor ? copyAnchor(anchor) : null;
	}

	setSurfaceAnchor(
		surface: NavigationMemorySurface,
		anchor: ScrollAnchor,
		session: AccountSessionSnapshot,
		neighborhood?: ScrollNeighborhood | null,
		contentGeneration?: number,
	): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		this.#surfaceAnchors.set(surface, copyAnchor(anchor));
		if (neighborhood)
			this.#surfaceNeighborhoods.set(surface, copyNeighborhood(neighborhood)!);
		else this.#surfaceNeighborhoods.delete(surface);
		if (contentGeneration === undefined)
			this.#surfaceGenerations.delete(surface);
		else this.#surfaceGenerations.set(surface, contentGeneration);
		return true;
	}

	clearSurfaceAnchor(
		surface: NavigationMemorySurface,
		session: AccountSessionSnapshot,
	): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		this.#surfaceAnchors.delete(surface);
		this.#surfaceNeighborhoods.delete(surface);
		this.#surfaceGenerations.delete(surface);
		return true;
	}

	getDetailSession(
		conversationId: string,
		session: AccountSessionSnapshot,
	): DetailSessionState {
		if (!isAccountSessionCurrent(session)) return { ...EMPTY_DETAIL_SESSION };

		const draft = this.#touchDraft(conversationId);
		const scrollAnchor = this.#touchConversationScrollAnchor(conversationId);
		return {
			scrollAnchor: scrollAnchor ? copyAnchor(scrollAnchor) : null,
			scrollNeighborhood: copyNeighborhood(
				this.#conversationNeighborhoods.get(conversationId),
			),
			draftText: draft?.draftText ?? "",
			replyTargetMessageId: draft?.replyTargetMessageId ?? null,
		};
	}

	updateDraft(
		conversationId: string,
		draft: { text: string; replyTargetMessageId: string | null },
		session: AccountSessionSnapshot,
	): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		if (draft.text === "" && draft.replyTargetMessageId === null) {
			this.#drafts.delete(conversationId);
			return true;
		}

		this.#drafts.delete(conversationId);
		this.#drafts.set(conversationId, {
			draftText: draft.text,
			replyTargetMessageId: draft.replyTargetMessageId,
		});
		while (this.#drafts.size > NAVIGATION_MEMORY_DRAFT_CAPACITY) {
			const leastRecent = this.#drafts.keys().next().value;
			if (leastRecent === undefined) break;
			this.#drafts.delete(leastRecent);
		}
		return true;
	}

	clearDraft(conversationId: string, session: AccountSessionSnapshot): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		this.#drafts.delete(conversationId);
		return true;
	}

	setConversationScrollAnchor(
		conversationId: string,
		anchor: ConversationScrollAnchor,
		session: AccountSessionSnapshot,
		neighborhood?: ScrollNeighborhood | null,
	): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		this.#conversationAnchors.delete(conversationId);
		this.#conversationAnchors.set(conversationId, copyAnchor(anchor));
		if (neighborhood)
			this.#conversationNeighborhoods.set(
				conversationId,
				copyNeighborhood(neighborhood)!,
			);
		else this.#conversationNeighborhoods.delete(conversationId);
		while (
			this.#conversationAnchors.size > NAVIGATION_MEMORY_CONVERSATION_CAPACITY
		) {
			const leastRecent = this.#conversationAnchors.keys().next().value;
			if (leastRecent === undefined) break;
			this.#conversationAnchors.delete(leastRecent);
			this.#conversationNeighborhoods.delete(leastRecent);
		}
		return true;
	}

	clearConversationScrollAnchor(
		conversationId: string,
		session: AccountSessionSnapshot,
	): boolean {
		if (!isAccountSessionCurrent(session)) return false;
		this.#conversationAnchors.delete(conversationId);
		this.#conversationNeighborhoods.delete(conversationId);
		return true;
	}

	#touchDraft(conversationId: string): DraftState | undefined {
		const draft = this.#drafts.get(conversationId);
		if (!draft) return undefined;
		this.#drafts.delete(conversationId);
		this.#drafts.set(conversationId, draft);
		return draft;
	}

	#touchConversationScrollAnchor(
		conversationId: string,
	): ConversationScrollAnchor | undefined {
		const anchor = this.#conversationAnchors.get(conversationId);
		if (!anchor) return undefined;
		this.#conversationAnchors.delete(conversationId);
		this.#conversationAnchors.set(conversationId, anchor);
		return anchor;
	}
}

export function resolveReplyTarget(
	conversationId: string,
	replyTargetMessageId: string | null,
	messages: readonly ApiResponseMessage[],
): ApiResponseMessage | null {
	if (replyTargetMessageId === null) return null;
	return (
		messages.find(
			(message) =>
				message.messageId === replyTargetMessageId &&
				message.conversationId === conversationId,
		) ?? null
	);
}

export function resolveScrollRestoration(
	anchor: ScrollAnchor,
	itemOffsets: ReadonlyMap<string, number>,
	neighborhood?: ScrollNeighborhood | null,
): { itemKey: string | null; scrollTop: number } {
	const itemOffset = itemOffsets.get(anchor.itemKey);
	if (itemOffset === undefined) {
		if (neighborhood) {
			for (
				let distance = 1;
				distance < neighborhood.orderedItemKeys.length;
				distance += 1
			) {
				for (const index of [
					neighborhood.anchorIndex - distance,
					neighborhood.anchorIndex + distance,
				]) {
					const itemKey = neighborhood.orderedItemKeys[index];
					if (!itemKey) continue;
					const offset = itemOffsets.get(itemKey);
					if (offset !== undefined)
						return { itemKey, scrollTop: offset - anchor.offsetPx };
				}
			}
		}
		return { itemKey: null, scrollTop: anchor.fallbackOffsetPx };
	}
	return {
		itemKey: anchor.itemKey,
		scrollTop: itemOffset - anchor.offsetPx,
	};
}

export function resolveConversationScrollRestoration(
	anchor: ConversationScrollAnchor,
	itemOffsets: ReadonlyMap<string, number>,
	viewport: { scrollHeight: number; clientHeight: number; floorSlopPx: number },
	neighborhood?: ScrollNeighborhood | null,
): { itemKey: string | null; scrollTop: number } {
	if (anchor.distanceFromEndPx <= viewport.floorSlopPx) {
		return {
			itemKey: null,
			scrollTop: Math.max(
				0,
				viewport.scrollHeight -
					viewport.clientHeight -
					anchor.distanceFromEndPx,
			),
		};
	}
	return resolveScrollRestoration(anchor, itemOffsets, neighborhood);
}

export class ScrollCaptureGate {
	#active = 0;
	get canCapture(): boolean {
		return this.#active === 0;
	}
	async suppressDuring<T>(work: () => Promise<T>): Promise<T> {
		this.#active += 1;
		try {
			return await work();
		} finally {
			this.#active -= 1;
		}
	}
}

export function captureScrollAnchor(
	container: HTMLElement,
	capturedAt = Date.now(),
	itemSelector = "[data-navigation-item-key]",
	keyAttribute = "data-navigation-item-key",
): ScrollAnchor {
	const containerRect = container.getBoundingClientRect();
	const items = container.querySelectorAll<HTMLElement>(itemSelector);
	for (const item of items) {
		const itemRect = item.getBoundingClientRect();
		if (
			itemRect.bottom <= containerRect.top ||
			itemRect.top >= containerRect.bottom
		)
			continue;
		const itemKey = item.getAttribute(keyAttribute);
		if (itemKey === null || itemKey === "") continue;
		return {
			itemKey,
			offsetPx: itemRect.top - containerRect.top,
			fallbackOffsetPx: container.scrollTop,
			capturedAt,
		};
	}
	return {
		itemKey: "",
		offsetPx: 0,
		fallbackOffsetPx: container.scrollTop,
		capturedAt,
	};
}

const SCROLL_NEIGHBORHOOD_RADIUS = 3;

export function captureScrollNeighborhood(
	container: HTMLElement,
	anchorItemKey: string,
	itemSelector = "[data-navigation-item-key]",
	keyAttribute = "data-navigation-item-key",
): ScrollNeighborhood | null {
	if (!anchorItemKey) return null;
	const keys = [...container.querySelectorAll<HTMLElement>(itemSelector)]
		.map((item) => item.getAttribute(keyAttribute))
		.filter((key): key is string => key !== null && key !== "");
	const fullAnchorIndex = keys.indexOf(anchorItemKey);
	if (fullAnchorIndex === -1) return null;
	const start = Math.max(0, fullAnchorIndex - SCROLL_NEIGHBORHOOD_RADIUS);
	const end = Math.min(
		keys.length,
		fullAnchorIndex + SCROLL_NEIGHBORHOOD_RADIUS + 1,
	);
	return {
		orderedItemKeys: keys.slice(start, end),
		anchorIndex: fullAnchorIndex - start,
	};
}

export function restoreScrollAnchor(
	container: HTMLElement,
	anchor: ScrollAnchor,
	itemSelector = "[data-navigation-item-key]",
	keyAttribute = "data-navigation-item-key",
	neighborhood?: ScrollNeighborhood | null,
): { itemKey: string | null; scrollTop: number } {
	const containerRect = container.getBoundingClientRect();
	const offsets = new Map<string, number>();
	for (const item of container.querySelectorAll<HTMLElement>(itemSelector)) {
		const itemKey = item.getAttribute(keyAttribute);
		if (itemKey === null || itemKey === "") continue;
		offsets.set(
			itemKey,
			container.scrollTop +
				item.getBoundingClientRect().top -
				containerRect.top,
		);
	}
	const restoration = resolveScrollRestoration(anchor, offsets, neighborhood);
	container.scrollTop = restoration.scrollTop;
	return restoration;
}

export async function restoreVirtualScrollAnchor({
	container,
	anchor,
	logicalItemKeys,
	scrollToIndex,
	toVirtualIndex = (itemIndex) => itemIndex,
	neighborhood,
}: {
	container: HTMLElement;
	anchor: ScrollAnchor;
	logicalItemKeys: readonly string[];
	scrollToIndex: (index: number) => Promise<void>;
	toVirtualIndex?: (itemIndex: number) => number;
	neighborhood?: ScrollNeighborhood | null;
}): Promise<{ itemKey: string | null; scrollTop: number }> {
	let itemKey = logicalItemKeys.includes(anchor.itemKey)
		? anchor.itemKey
		: null;
	if (itemKey === null && neighborhood) {
		for (
			let distance = 1;
			distance < neighborhood.orderedItemKeys.length;
			distance += 1
		) {
			for (const index of [
				neighborhood.anchorIndex - distance,
				neighborhood.anchorIndex + distance,
			]) {
				const candidate = neighborhood.orderedItemKeys[index];
				if (candidate && logicalItemKeys.includes(candidate)) {
					itemKey = candidate;
					break;
				}
			}
			if (itemKey !== null) break;
		}
	}
	if (itemKey === null) {
		container.scrollTop = anchor.fallbackOffsetPx;
		return { itemKey: null, scrollTop: anchor.fallbackOffsetPx };
	}
	await scrollToIndex(toVirtualIndex(logicalItemKeys.indexOf(itemKey)));
	return restoreScrollAnchor(
		container,
		anchor,
		undefined,
		undefined,
		neighborhood,
	);
}

export const navigationMemory = new NavigationMemory();
registerAccountCache(() => navigationMemory.clear());
