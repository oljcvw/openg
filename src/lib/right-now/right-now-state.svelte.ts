import { untrack } from "svelte";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { showErrorToast } from "$lib/api/error";
import type { rightNowV4QuerySchema } from "$lib/model/right-now/feed/query/v4";
import { type FeedPost, type FeedSnapshot, getPosts } from "./posts";
import { RightNowSearchFiltersState } from "./right-now-filters-state.svelte";

const PAGE_SIZE = 12;

type RightNowLoader = (
	query: z.infer<typeof rightNowV4QuerySchema>,
) => Promise<FeedSnapshot>;

export class RightNowState {
	filters: RightNowSearchFiltersState;
	loading = $state(false);
	refreshing = $state(false);
	error: Error | null = $state(null);
	viewerCount = $state(0);

	#allPosts: FeedPost[] = $state([]);
	#fetchToken = 0;
	#loaded = false;
	#loader: RightNowLoader;
	#visibleCount = $state(PAGE_SIZE);

	constructor({
		loader = getPosts,
		filters,
	}: {
		loader?: RightNowLoader;
		filters?: RightNowSearchFiltersState;
	} = {}) {
		this.#loader = loader;
		this.filters =
			filters ??
			new RightNowSearchFiltersState({
				onRefresh: () => void this.retry(),
			});
	}

	visiblePosts(currentTime: number): FeedPost[] {
		return this.#activePosts(currentTime).slice(0, this.#visibleCount);
	}

	hasMore(currentTime: number): boolean {
		return this.#visibleCount < this.#activePosts(currentTime).length;
	}

	pruneExpired(currentTime: number): void {
		const active = this.#activePosts(currentTime);
		if (active.length !== this.#allPosts.length) this.#allPosts = active;
	}

	loadMore() {
		this.#visibleCount += PAGE_SIZE;
	}

	load(): Promise<void> {
		if (untrack(() => this.#loaded || this.loading)) return Promise.resolve();
		return this.#startLoad();
	}

	retry(): Promise<void> {
		this.#loaded = false;
		this.#allPosts = [];
		this.viewerCount = 0;
		return this.#startLoad();
	}

	async refresh(): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			await this.#fetchPosts({ silent: true });
		} finally {
			this.refreshing = false;
		}
	}

	reset(): void {
		this.#fetchToken += 1;
		this.#loaded = false;
		this.#allPosts = [];
		this.#visibleCount = PAGE_SIZE;
		this.loading = false;
		this.refreshing = false;
		this.error = null;
		this.viewerCount = 0;
		this.filters.reset();
	}

	async #startLoad(): Promise<void> {
		this.#fetchToken += 1;
		this.#visibleCount = PAGE_SIZE;
		this.loading = true;
		this.error = null;
		await this.#fetchPosts();
	}

	async #fetchPosts({ silent = false }: { silent?: boolean } = {}) {
		const token = ++this.#fetchToken;
		try {
			await this.filters.ready;
			if (token !== this.#fetchToken) return;
			const filters = this.filters.value;
			const query = {
				sort: filters?.sort ?? "DISTANCE",
				...(filters &&
					filters.hosting !== null && {
						hosting: filters.hosting,
					}),
				...(filters?.positionEnabled && {
					sexualPositions: filters.positions,
				}),
				...(filters?.ageEnabled && {
					ageMin: filters.age[0],
					ageMax: filters.age[1],
				}),
			} satisfies z.infer<typeof rightNowV4QuerySchema>;
			const snapshot = await this.#loader(query);
			if (token !== this.#fetchToken) return;

			this.#allPosts = snapshot.posts;
			this.viewerCount = snapshot.viewerCount;
			this.#visibleCount = PAGE_SIZE;
			this.#loaded = true;
			this.error = null;
		} catch (error) {
			if (token !== this.#fetchToken) return;
			if (silent) {
				showErrorToast({ label: "Failed to refresh Right Now feed", error });
			} else {
				this.error =
					error instanceof Error
						? error
						: new Error("Failed to fetch Right Now feed", { cause: error });
			}
		} finally {
			if (token === this.#fetchToken) this.loading = false;
		}
	}

	#activePosts(currentTime: number): FeedPost[] {
		return this.#allPosts.filter((post) => post.expiration > currentTime);
	}
}

export const rightNowState = new RightNowState();

registerAccountCache(() => rightNowState.reset());
