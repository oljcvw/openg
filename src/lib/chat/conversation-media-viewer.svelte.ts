import { createContext } from "svelte";

import { backLayerManager } from "$lib/navigation/app-navigation";
import {
	reportViewerDiagnostic,
	type ViewerDiagnostic,
} from "$lib/platform/client-diagnostics";

export type ViewerLifecyclePhase =
	| "closed"
	| "resolving"
	| "ready"
	| "opening"
	| "open"
	| "closing";

export type ConversationMediaViewerItem = {
	id: string;
	kind: "image" | "video";
	url: string | null;
	width?: number;
	height?: number;
	poster?: string | null;
	unavailableLabel?: string;
};

export type ViewerDiagnosticContext = Pick<
	ViewerDiagnostic,
	"surface" | "cacheSource" | "access"
>;

const DEFAULT_DIAGNOSTIC_CONTEXT: ViewerDiagnosticContext = {
	surface: "chat",
	cacheSource: "none",
	access: "persistent",
};

export type ConversationMediaViewerSession = {
	items: ConversationMediaViewerItem[];
	startId: string;
	messageId: string | null;
	opener: HTMLElement | null;
	preload?: [number, number];
	statusLabel?: string | null;
	onItemActivate?: (item: ConversationMediaViewerItem, index: number) => void;
	diagnostics?: ViewerDiagnosticContext;
};

type ResolvedExplicitSession = Omit<
	ConversationMediaViewerSession,
	"messageId" | "opener"
>;

export class ConversationMediaViewerState {
	phase: ViewerLifecyclePhase = $state("closed");
	items: ConversationMediaViewerItem[] = $state([]);
	startIndex = $state(0);
	opener: HTMLElement | null = $state(null);
	activeMessageId: string | null = $state(null);
	preload: [number, number] = $state([1, 2]);
	statusLabel: string | null = $state(null);
	onItemActivate:
		| ((item: ConversationMediaViewerItem, index: number) => void)
		| null = $state(null);
	diagnostics: ViewerDiagnosticContext = $state({
		...DEFAULT_DIAGNOSTIC_CONTEXT,
	});

	#pin: (messageId: string) => void;
	#unpin: (messageId: string) => void;
	#generation = 0;
	#abortController: AbortController | null = null;
	#resolvers = new Map<string, unknown>();
	#releaseBackLayer: (() => void) | null = null;
	#requestStartedAt = 0;

	constructor({
		pin = () => {},
		unpin = () => {},
	}: {
		pin?: (messageId: string) => void;
		unpin?: (messageId: string) => void;
	} = {}) {
		this.#pin = pin;
		this.#unpin = unpin;
	}

	get ownerCount(): number {
		return this.activeMessageId !== null || this.items.length > 0 ? 1 : 0;
	}

	get ready(): boolean {
		return this.items.length > 0;
	}

	open(session: ConversationMediaViewerSession): void {
		this.close();
		this.#acquireBackLayer();
		this.#applySession(session);
	}

	async openExplicit({
		messageId,
		opener,
		diagnostics = {
			surface: "album",
			cacheSource: "none",
			access: "persistent",
		},
		resolve,
	}: {
		messageId: string;
		opener: HTMLElement | null;
		diagnostics?: ViewerDiagnosticContext;
		resolve: (signal: AbortSignal) => Promise<ResolvedExplicitSession>;
	}): Promise<boolean> {
		this.close();
		const generation = ++this.#generation;
		const abortController = new AbortController();
		this.#abortController = abortController;
		this.opener = opener;
		this.activeMessageId = messageId;
		this.diagnostics = diagnostics;
		this.phase = "resolving";
		this.#requestStartedAt = performance.now();
		this.#report("resolving");
		this.#acquireBackLayer();
		this.#pin(messageId);
		try {
			const session = await resolve(abortController.signal);
			if (abortController.signal.aborted || generation !== this.#generation)
				return false;
			this.#applyResolvedSession(session);
			this.#report("resolved");
			return true;
		} catch (error) {
			if (
				abortController.signal.aborted ||
				(error instanceof DOMException && error.name === "AbortError") ||
				generation !== this.#generation
			)
				return false;
			this.close();
			throw error;
		}
	}

	retainResolver<T>(identity: string, create: () => T): T {
		if (!this.#resolvers.has(identity)) this.#resolvers.set(identity, create());
		return this.#resolvers.get(identity) as T;
	}

	clearConversation(): void {
		this.close();
		this.#resolvers.clear();
	}

	close(): void {
		if (
			this.phase === "closed" &&
			this.activeMessageId === null &&
			this.items.length === 0 &&
			this.#abortController === null &&
			this.#releaseBackLayer === null
		)
			return;
		const cancelled = this.phase === "resolving";
		if (cancelled) this.#report("cancelled", "cancelled");
		this.phase = "closing";
		this.#generation += 1;
		this.#abortController?.abort();
		this.#abortController = null;
		this.#releaseBackLayer?.();
		this.#releaseBackLayer = null;
		if (this.activeMessageId !== null) this.#unpin(this.activeMessageId);
		this.items = [];
		this.startIndex = 0;
		this.opener = null;
		this.activeMessageId = null;
		this.preload = [1, 2];
		this.statusLabel = null;
		this.onItemActivate = null;
		this.diagnostics = { ...DEFAULT_DIAGNOSTIC_CONTEXT };
		this.phase = "closed";
	}

	markOpening(): void {
		if (this.phase === "ready") this.phase = "opening";
	}

	markOpened(): void {
		if (this.phase === "ready" || this.phase === "opening") this.phase = "open";
	}

	/** Replace a mutable deck without losing the coordinator's stable selection. */
	updateItems(items: ConversationMediaViewerItem[]): void {
		if (this.phase === "closed" || items.length === 0) return;
		const selectedId = this.items[this.startIndex]?.id ?? this.activeMessageId;
		this.items = [...items];
		const selectedIndex = selectedId
			? this.items.findIndex((item) => item.id === selectedId)
			: -1;
		this.startIndex = selectedIndex >= 0 ? selectedIndex : 0;
	}

	#applySession(session: ConversationMediaViewerSession): void {
		this.activeMessageId = session.messageId;
		this.opener = session.opener;
		this.diagnostics = session.diagnostics ?? {
			...DEFAULT_DIAGNOSTIC_CONTEXT,
		};
		if (session.messageId !== null) this.#pin(session.messageId);
		this.#applyResolvedSession(session);
	}

	#applyResolvedSession(session: ResolvedExplicitSession): void {
		const { items, startId } = session;
		this.items = [...items];
		const index = this.items.findIndex((item) => item.id === startId);
		this.startIndex = index === -1 ? 0 : index;
		this.preload = session.preload ?? [1, 2];
		this.statusLabel = session.statusLabel ?? null;
		this.onItemActivate = session.onItemActivate ?? null;
		if (session.diagnostics !== undefined)
			this.diagnostics = session.diagnostics;
		this.phase = "ready";
	}

	#report(
		event: ViewerDiagnostic["event"],
		failure: ViewerDiagnostic["failure"] = "none",
	): void {
		reportViewerDiagnostic({
			event,
			...this.diagnostics,
			mediaKind: "none",
			countBucket: "none",
			positionBucket: "none",
			latencyBucket: latencyBucket(performance.now() - this.#requestStartedAt),
			failure,
		});
	}

	#acquireBackLayer(): void {
		this.#releaseBackLayer?.();
		this.#releaseBackLayer = backLayerManager.register({
			priority: "viewer",
			handler: () => {
				this.close();
				return "handled";
			},
		});
	}
}

function latencyBucket(
	milliseconds: number,
): ViewerDiagnostic["latencyBucket"] {
	if (milliseconds < 100) return "instant";
	if (milliseconds < 1_000) return "fast";
	if (milliseconds < 5_000) return "slow";
	return "very_slow";
}

export const [getConversationMediaViewer, setConversationMediaViewer] =
	createContext<() => ConversationMediaViewerState>();
