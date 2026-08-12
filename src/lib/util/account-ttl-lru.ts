export class AccountTtlLru<T> {
	readonly #capacity: () => number;
	readonly #ttlMs: number;
	readonly #now: () => number;
	readonly #entries = new Map<string, { value: T; updatedAt: number }>();
	#owner = "";

	constructor(options: {
		capacity: () => number;
		ttlMs: number;
		now?: () => number;
	}) {
		this.#capacity = options.capacity;
		this.#ttlMs = options.ttlMs;
		this.#now = options.now ?? Date.now;
	}

	get size(): number {
		return this.#entries.size;
	}

	setAccount(accountId: number | null, generation: number): void {
		const owner = `${accountId ?? "none"}:${generation}`;
		if (owner === this.#owner) return;
		this.#owner = owner;
		this.#entries.clear();
	}

	get(key: string | number): T | null {
		const normalized = String(key);
		const entry = this.#entries.get(normalized);
		if (!entry) return null;
		if (this.#now() - entry.updatedAt >= this.#ttlMs) {
			this.#entries.delete(normalized);
			return null;
		}
		this.#entries.delete(normalized);
		this.#entries.set(normalized, entry);
		return entry.value;
	}

	set(key: string | number, value: T, updatedAt = this.#now()): void {
		const normalized = String(key);
		this.#entries.delete(normalized);
		this.#entries.set(normalized, { value, updatedAt });
		const capacity = Math.max(1, this.#capacity());
		while (this.#entries.size > capacity) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
	}

	delete(key: string | number): void {
		this.#entries.delete(String(key));
	}

	clear(): void {
		this.#entries.clear();
	}
}
