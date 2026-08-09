import { createContext } from "svelte";

export type ConversationMediaViewerItem = {
	id: string;
	kind: "image" | "video";
	url: string | null;
	width?: number;
	height?: number;
	poster?: string | null;
	unavailableLabel?: string;
};

export type ConversationMediaViewerSession = {
	items: ConversationMediaViewerItem[];
	startId: string;
	messageId: string | null;
	opener: HTMLElement | null;
	preload?: [number, number];
	statusLabel?: string | null;
	onItemActivate?: (item: ConversationMediaViewerItem, index: number) => void;
};

type ResolvedExplicitSession = Omit<
	ConversationMediaViewerSession,
	"messageId" | "opener"
>;

export class ConversationMediaViewerState {
	items: ConversationMediaViewerItem[] = $state([]);
	startIndex = $state(0);
	opener: HTMLElement | null = $state(null);
	activeMessageId: string | null = $state(null);
	preload: [number, number] = $state([1, 2]);
	statusLabel: string | null = $state(null);
	onItemActivate:
		| ((item: ConversationMediaViewerItem, index: number) => void)
		| null = $state(null);

	#pin: (messageId: string) => void;
	#unpin: (messageId: string) => void;
	#generation = 0;
	#abortController: AbortController | null = null;
	#resolvers = new Map<string, unknown>();

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
		this.#applySession(session);
	}

	async openExplicit({
		messageId,
		opener,
		resolve,
	}: {
		messageId: string;
		opener: HTMLElement | null;
		resolve: (signal: AbortSignal) => Promise<ResolvedExplicitSession>;
	}): Promise<boolean> {
		this.close();
		const generation = ++this.#generation;
		const abortController = new AbortController();
		this.#abortController = abortController;
		this.opener = opener;
		this.activeMessageId = messageId;
		this.#pin(messageId);
		try {
			const session = await resolve(abortController.signal);
			if (abortController.signal.aborted || generation !== this.#generation)
				return false;
			this.#applyResolvedSession(session);
			return true;
		} catch (error) {
			if (generation === this.#generation) this.close();
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
		this.#generation += 1;
		this.#abortController?.abort();
		this.#abortController = null;
		if (this.activeMessageId !== null) this.#unpin(this.activeMessageId);
		this.items = [];
		this.startIndex = 0;
		this.opener = null;
		this.activeMessageId = null;
		this.preload = [1, 2];
		this.statusLabel = null;
		this.onItemActivate = null;
	}

	#applySession(session: ConversationMediaViewerSession): void {
		this.activeMessageId = session.messageId;
		this.opener = session.opener;
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
	}
}

export const [getConversationMediaViewer, setConversationMediaViewer] =
	createContext<() => ConversationMediaViewerState>();
