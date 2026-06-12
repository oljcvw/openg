import z from "zod";

import { showErrorToast } from "$lib/api/error";
import type { cascadeV3QuerySchema } from "$lib/model/grid/cascade/query/v3";
import {
	getGrid,
	type GridProfile,
	profileCache,
	resolvePartialBatch,
} from "../../(navbar)/(root)/grid";

class FavoritesGridState {
	items = $state<GridProfile[]>([]);
	partialBatches: { batch: { profileId: number }[] }[] = [];
	nextPage = $state<number | null>(0);
	loadingMore = $state(false);
	loading = $state(false);
	error = $state<Error | null>(null);
	scrollY = 0;
	currentQuery: z.infer<typeof cascadeV3QuerySchema> | null = null;

	#geohash: string | null = null;
	#loadingBatches = new Set<number>();
	#requestGeneration = 0;

	get errorMessage(): string | null {
		return this.error?.message ?? null;
	}

	load(geohash: string): void {
		this.#geohash = geohash;
		this.#reset();
		const generation = ++this.#requestGeneration;
		void this.#fetchProfiles(geohash, generation);
	}

	refresh(): void {
		if (!this.#geohash) return;
		this.#reset();
		this.scrollY = 0;
		const generation = ++this.#requestGeneration;
		void this.#fetchProfiles(this.#geohash, generation);
	}

	#reset(): void {
		this.#requestGeneration += 1;
		this.items = [];
		this.partialBatches = [];
		this.nextPage = 0;
		this.loadingMore = false;
		this.loading = true;
		this.error = null;
		this.currentQuery = null;
		this.#loadingBatches.clear();
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || !this.nextPage || !this.currentQuery) return;
		const generation = this.#requestGeneration;
		this.loadingMore = true;
		try {
			const batchOffset = this.partialBatches.length;
			const result = await getGrid({
				...this.currentQuery,
				pageNumber: this.nextPage,
			});
			if (generation !== this.#requestGeneration) return;
			for (const item of result.items) {
				this.items.push(
					item.type === "partial"
						? { ...item, batchIndex: item.batchIndex + batchOffset }
						: item,
				);
			}
			this.partialBatches.push(...result.partialBatches);
			this.nextPage = result.nextPage;
		} catch (error) {
			if (generation !== this.#requestGeneration) return;
			console.error(error);
			showErrorToast({
				label: "Failed to load more favorites",
				error,
			});
		} finally {
			this.loadingMore = false;
		}
	}

	async loadBatch(batchIndex: number): Promise<void> {
		if (this.#loadingBatches.has(batchIndex)) return;
		const generation = this.#requestGeneration;
		this.#loadingBatches.add(batchIndex);
		try {
			if (generation !== this.#requestGeneration) return;
			const batch = this.partialBatches[batchIndex];
			if (!batch) return;
			const profileIds = batch.batch.map((p) => p.profileId);
			const uncachedIds: number[] = [];

			for (const id of profileIds) {
				const cached = profileCache.get(id);
				if (cached) {
					const idx = this.items.findIndex((i) => i.id === id);
					if (idx !== -1) this.items[idx] = cached;
				} else {
					uncachedIds.push(id);
				}
			}

			const resolved = await resolvePartialBatch(uncachedIds);
			if (generation !== this.#requestGeneration) return;
			for (const profile of resolved) {
				profileCache.set(profile.id, profile);
				const idx = this.items.findIndex((i) => i.id === profile.id);
				if (idx !== -1) this.items[idx] = profile;
			}

			const unresolved = uncachedIds.filter(
				(id) => !resolved.some((profile) => profile.id === id),
			);
			for (const id of unresolved) {
				const idx = this.items.findIndex((i) => i.id === id);
				if (idx !== -1) this.items.splice(idx, 1);
			}
		} catch (error) {
			if (generation !== this.#requestGeneration) return;
			console.error(batchIndex, error);
			showErrorToast({
				label: "Failed to load favorite profiles",
				error,
			});
		} finally {
			this.#loadingBatches.delete(batchIndex);
		}
	}

	async #fetchProfiles(geohash: string, generation: number): Promise<void> {
		try {
			const query = {
				nearbyGeoHash: geohash,
				favorites: true,
			} satisfies z.infer<typeof cascadeV3QuerySchema>;
			this.currentQuery = query;
			const result = await getGrid(query);
			if (generation !== this.#requestGeneration) return;
			this.#loadingBatches.clear();
			this.items = result.items;
			this.partialBatches = result.partialBatches;
			this.nextPage = result.nextPage;
			this.loading = false;
		} catch (err) {
			if (generation !== this.#requestGeneration) return;
			console.error(err);
			this.error =
				err instanceof Error
					? err
					: new Error("Failed to fetch favorite profiles", { cause: err });
			if (generation === this.#requestGeneration) {
				this.loading = false;
			}
		}
	}
}

export const favoritesGridState = new FavoritesGridState();
