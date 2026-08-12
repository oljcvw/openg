export class ObjectUrlRegistry {
	readonly #owned = new Set<string>();
	readonly #revoke: (url: string) => void;

	constructor(
		revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
	) {
		this.#revoke = revoke;
	}

	add(url: string): string {
		if (url.startsWith("blob:")) this.#owned.add(url);
		return url;
	}

	release(url: string | null | undefined): void {
		if (!url || !this.#owned.delete(url)) return;
		this.#revoke(url);
	}

	clear(): void {
		for (const url of [...this.#owned]) this.release(url);
	}
}
