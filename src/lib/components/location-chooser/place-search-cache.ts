export class PlaceSearchCache<T> {
	#entries = new Map<string, T>();
	#capacity: number;

	constructor(capacity: number) {
		this.#capacity = Math.max(1, Math.floor(capacity));
	}

	setCapacity(capacity: number): void {
		this.#capacity = Math.max(1, Math.floor(capacity));
		this.#evict();
	}

	get(query: string): T | undefined {
		const key = normalize(query);
		const value = this.#entries.get(key);
		if (value === undefined) return undefined;
		this.#entries.delete(key);
		this.#entries.set(key, value);
		return value;
	}

	set(query: string, value: T): void {
		const key = normalize(query);
		this.#entries.delete(key);
		this.#entries.set(key, value);
		this.#evict();
	}

	#evict(): void {
		while (this.#entries.size > this.#capacity) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) return;
			this.#entries.delete(oldest);
		}
	}
}

function normalize(query: string): string {
	return query.trim().toLocaleLowerCase();
}
