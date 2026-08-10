import type { ReceivedAlbumBrief } from "$lib/model/messaging/albums";

export function isSafeToHydrateReceivedAlbum(
	album: ReceivedAlbumBrief,
): boolean {
	return (
		album.albumViewable &&
		album.expirationType === "INDEFINITE" &&
		album.expiresAt === null
	);
}

type Job<T> = {
	albumId: number;
	abortController: AbortController;
	resolve: (value: T | null) => void;
	reject: (error: unknown) => void;
	started: boolean;
};

/** Bounded, cancellable and successful-result-caching visible-row hydration. */
export class ReceivedAlbumHydrator<T> {
	readonly #load: (albumId: number, signal: AbortSignal) => Promise<T>;
	readonly #concurrency: number;
	readonly #cache = new Map<number, T>();
	readonly #jobs = new Map<number, Job<T>>();
	readonly #pending = new Map<number, Promise<T | null>>();
	readonly #queue: Job<T>[] = [];
	#active = 0;

	constructor(
		load: (albumId: number, signal: AbortSignal) => Promise<T>,
		concurrency = 2,
	) {
		if (!Number.isSafeInteger(concurrency) || concurrency < 1)
			throw new Error("Received album hydration concurrency must be positive");
		this.#load = load;
		this.#concurrency = concurrency;
	}

	getCached(albumId: number): T | null {
		return this.#cache.get(albumId) ?? null;
	}

	request(albumId: number): Promise<T | null> {
		const cached = this.#cache.get(albumId);
		if (cached !== undefined) return Promise.resolve(cached);
		const existing = this.#pending.get(albumId);
		if (existing) return existing;
		const pending = new Promise<T | null>((resolve, reject) => {
			const job: Job<T> = {
				albumId,
				abortController: new AbortController(),
				resolve,
				reject,
				started: false,
			};
			this.#jobs.set(albumId, job);
			this.#queue.push(job);
			this.#drain();
		});
		this.#pending.set(albumId, pending);
		return pending;
	}

	cancel(albumId: number): void {
		const job = this.#jobs.get(albumId);
		if (!job) return;
		job.abortController.abort();
		if (!job.started) {
			const index = this.#queue.indexOf(job);
			if (index >= 0) this.#queue.splice(index, 1);
			this.#jobs.delete(albumId);
			this.#pending.delete(albumId);
			job.resolve(null);
		}
	}

	clear(): void {
		for (const albumId of this.#jobs.keys()) this.cancel(albumId);
		this.#cache.clear();
	}

	#drain(): void {
		while (this.#active < this.#concurrency) {
			const job = this.#queue.shift();
			if (!job) return;
			if (job.abortController.signal.aborted) {
				this.#jobs.delete(job.albumId);
				this.#pending.delete(job.albumId);
				job.resolve(null);
				continue;
			}
			job.started = true;
			this.#active += 1;
			void this.#load(job.albumId, job.abortController.signal)
				.then((value) => {
					if (job.abortController.signal.aborted) {
						job.resolve(null);
						return;
					}
					this.#cache.set(job.albumId, value);
					job.resolve(value);
				})
				.catch((error) => {
					if (
						job.abortController.signal.aborted ||
						(error instanceof DOMException && error.name === "AbortError")
					)
						job.resolve(null);
					else job.reject(error);
				})
				.finally(() => {
					this.#jobs.delete(job.albumId);
					this.#pending.delete(job.albumId);
					this.#active -= 1;
					this.#drain();
				});
		}
	}
}
