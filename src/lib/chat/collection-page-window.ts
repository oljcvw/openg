export type CollectionPage<T> = {
	index: number;
	items: T[];
};

/**
 * Bounds hydrated collection state to the focused page and its two neighbors.
 * A viewer/detail item is independently pinned across page eviction and clear.
 */
export class CollectionPageWindow<T> {
	readonly #getKey: (item: T) => string;
	readonly #onEvict: (items: T[]) => void;
	#pages = new Map<number, T[]>();
	#focusedPage: number | null = null;
	#pinned: T | null = null;

	constructor(
		getKey: (item: T) => string,
		options: { onEvict?: (items: T[]) => void } = {},
	) {
		this.#getKey = getKey;
		this.#onEvict = options.onEvict ?? (() => {});
	}

	get pageIndexes(): number[] {
		return [...this.#pages.keys()].toSorted((left, right) => left - right);
	}

	get items(): T[] {
		const byKey = new Map<string, T>();
		for (const index of this.pageIndexes) {
			for (const item of this.#pages.get(index) ?? [])
				byKey.set(this.#getKey(item), item);
		}
		if (this.#pinned !== null) {
			const key = this.#getKey(this.#pinned);
			if (!byKey.has(key)) byKey.set(key, this.#pinned);
		}
		return [...byKey.values()];
	}

	setPage(index: number, items: readonly T[]): void {
		const safeIndex = Math.max(0, Math.trunc(index));
		const previous = this.#pages.get(safeIndex) ?? [];
		this.#pages.set(safeIndex, [...items]);
		this.#release(
			previous.filter(
				(item) =>
					!items.some(
						(candidate) => this.#getKey(candidate) === this.#getKey(item),
					),
			),
		);
	}

	focus(index: number): void {
		this.#focusedPage = Math.max(0, Math.trunc(index));
		for (const pageIndex of this.pageIndexes) {
			if (Math.abs(pageIndex - this.#focusedPage) <= 1) continue;
			const evicted = this.#pages.get(pageIndex) ?? [];
			this.#pages.delete(pageIndex);
			this.#release(evicted);
		}
	}

	pin(item: T): void {
		const previous = this.#pinned;
		this.#pinned = item;
		if (previous !== null && this.#getKey(previous) !== this.#getKey(item))
			this.#release([previous]);
	}

	unpin(): void {
		const pinned = this.#pinned;
		this.#pinned = null;
		if (pinned !== null && !this.#contains(this.#getKey(pinned)))
			this.#onEvict([pinned]);
	}

	clear(): void {
		const evicted = [...this.#pages.values()].flat();
		this.#pages.clear();
		this.#focusedPage = null;
		this.#release(evicted);
	}

	#contains(key: string): boolean {
		return [...this.#pages.values()].some((items) =>
			items.some((item) => this.#getKey(item) === key),
		);
	}

	#release(items: readonly T[]): void {
		const pinnedKey = this.#pinned === null ? null : this.#getKey(this.#pinned);
		const released = new Map<string, T>();
		for (const item of items) {
			const key = this.#getKey(item);
			if (key !== pinnedKey && !this.#contains(key)) released.set(key, item);
		}
		if (released.size > 0) this.#onEvict([...released.values()]);
	}
}
