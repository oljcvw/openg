import { untrack } from "svelte";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { ApiError } from "$lib/api/api-error";
import { showErrorToast } from "$lib/api/error";
import { readCachedGrid, writeCachedGrid } from "$lib/app-data/grid-cache";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
import type { cascadeV4QuerySchema } from "$lib/model/browse/grid/cascade/query/v4";
import {
	getCachedProfile,
	getGrid,
	type GridProfile,
	resolveLazyProfiles,
	setCachedProfile,
} from "./grid";
import { GridSearchFiltersState } from "./grid-search-filters-state.svelte";
import {
	type AdjacentProfileIds,
	getAdjacentProfileIds,
} from "./profile-navigation";

const MAX_LAZY_RETRY_ATTEMPTS = 2;

export class GridState {
	filters = new GridSearchFiltersState({ onRefresh: () => this.retry() });
	items: GridProfile[] = $state([]);
	nextPage: number | null = $state(0);
	loadingMore = $state(false);
	loading = $state(false);
	refreshing = $state(false);
	error: Error | null = $state(null);

	get errorMessage(): string | null {
		return this.error?.message ?? null;
	}

	get hasMoreProfiles(): boolean {
		return this.nextPage !== 0 && this.nextPage !== null;
	}

	getProfileNavigation(profileId: number): AdjacentProfileIds {
		return getAdjacentProfileIds(this.items, profileId);
	}

	async getAdjacentProfileId(
		profileId: number,
		direction: "next" | "previous",
	): Promise<number | null> {
		let adjacent = this.getProfileNavigation(profileId);
		if (direction === "previous") return adjacent.previousProfileId;
		if (adjacent.nextProfileId !== null) return adjacent.nextProfileId;
		if (!this.hasMoreProfiles) return null;

		await this.loadMore();
		adjacent = this.getProfileNavigation(profileId);
		return adjacent.nextProfileId;
	}
	currentQuery: z.infer<typeof cascadeV4QuerySchema> | null = null;
	scrollY = 0;

	#geohash: string | null = null;
	#fetchToken = 0;
	#cascadeDrain: Promise<void> | null = null;
	#pendingFetch: { geohash: string; silent: boolean } | null = null;
	#pendingLoadMore = false;
	#loadMoreDrain: Promise<void> | null = null;
	#pendingLazyIds = new Set<number>();
	#lazyRetryIds = new Set<number>();
	#lazyRetryAttempts = new Map<number, number>();
	#lazyRetryTimer: ReturnType<typeof setTimeout> | null = null;
	#lazyRetryAt = 0;
	#lazyBatchActive = false;
	#lazyBatchScheduled = false;

	load(geohash: string): void {
		if (untrack(() => this.#geohash === geohash && this.items.length > 0))
			return;
		this.#geohash = geohash;
		this.#reset();
		this.scrollY = 0;
		this.#queueFetch(geohash);
	}

	retry(): void {
		if (!this.#geohash) return;
		this.#reset();
		this.scrollY = 0;
		this.#queueFetch(this.#geohash);
	}

	invalidate(): void {
		this.#fetchToken += 1;
		this.#pendingFetch = null;
		this.#pendingLoadMore = false;
		this.#reset();
		this.loading = false;
		this.refreshing = false;
		this.scrollY = 0;
		this.#geohash = null;
	}

	async refresh(): Promise<void> {
		if (!this.#geohash || this.refreshing) return;
		this.refreshing = true;
		this.#queueFetch(this.#geohash, true);
		await this.#cascadeDrain;
	}

	#reset(): void {
		this.items = [];
		this.nextPage = 0;
		this.loadingMore = false;
		this.loading = true;
		this.error = null;
		this.currentQuery = null;
		this.#pendingLazyIds.clear();
		this.#lazyRetryIds.clear();
		this.#lazyRetryAttempts.clear();
		if (this.#lazyRetryTimer !== null) clearTimeout(this.#lazyRetryTimer);
		this.#lazyRetryTimer = null;
		this.#lazyRetryAt = 0;
	}

	reset(): void {
		this.#fetchToken += 1;
		this.#pendingFetch = null;
		this.#pendingLoadMore = false;
		this.#pendingLazyIds.clear();
		this.#reset();
		this.loading = false;
		this.refreshing = false;
		this.scrollY = 0;
		this.#geohash = null;
		this.filters.reset();
	}

	async loadMore(): Promise<void> {
		if (this.#loadMoreDrain !== null) return await this.#loadMoreDrain;
		if (!this.nextPage || !this.currentQuery) return;
		this.#pendingLoadMore = true;
		this.loadingMore = true;
		this.#ensureCascadeDrain();
		const drain = this.#cascadeDrain;
		if (drain === null) return;
		const loadMoreDrain = drain.finally(() => {
			if (this.#loadMoreDrain === loadMoreDrain) this.#loadMoreDrain = null;
		});
		this.#loadMoreDrain = loadMoreDrain;
		await loadMoreDrain;
	}

	resolveProfile(id: number): Promise<void> {
		const item = this.items.find((candidate) => candidate.id === id);
		if (!item || item.type !== "lazy") return Promise.resolve();
		const cached = getCachedProfile(id);
		if (cached) {
			const index = this.items.findIndex((candidate) => candidate.id === id);
			if (index !== -1) this.items[index] = cached;
			return Promise.resolve();
		}
		this.#pendingLazyIds.add(id);
		if (!this.#lazyBatchScheduled) {
			this.#lazyBatchScheduled = true;
			const { profileResolutionWindowMs } = getDeveloperSettingsSnapshot();
			setTimeout(() => {
				this.#lazyBatchScheduled = false;
				void this.#drainLazyBatches();
			}, profileResolutionWindowMs);
		}
		return Promise.resolve();
	}

	#queueFetch(geohash: string, silent = false): void {
		this.#fetchToken += 1;
		this.#pendingFetch = { geohash, silent };
		this.#pendingLoadMore = false;
		this.#ensureCascadeDrain();
	}

	#ensureCascadeDrain(): void {
		if (this.#cascadeDrain !== null) return;
		const drain = this.#drainCascadeQueue().finally(() => {
			if (this.#cascadeDrain === drain) this.#cascadeDrain = null;
			if (this.#pendingFetch || this.#pendingLoadMore) {
				this.#ensureCascadeDrain();
			}
		});
		this.#cascadeDrain = drain;
	}

	async #drainCascadeQueue(): Promise<void> {
		try {
			while (this.#pendingFetch || this.#pendingLoadMore) {
				if (this.#pendingFetch) {
					const request = this.#pendingFetch;
					this.#pendingFetch = null;
					await this.#fetchProfiles(request.geohash, {
						silent: request.silent,
					});
					continue;
				}
				this.#pendingLoadMore = false;
				await this.#loadMorePage();
			}
		} finally {
			this.loadingMore = false;
		}
	}

	async #loadMorePage(): Promise<void> {
		if (!this.nextPage || !this.currentQuery) {
			this.loadingMore = false;
			return;
		}
		const token = this.#fetchToken;
		try {
			const result = await getGrid({
				...this.currentQuery,
				pageNumber: this.nextPage,
			});
			if (token !== this.#fetchToken) return;
			this.items.push(...result.items);
			this.nextPage = result.nextPage;
		} catch (error) {
			console.error("Browse load-more request failed");
			showErrorToast({ label: "Failed to load more profiles", error });
		} finally {
			this.loadingMore = false;
		}
	}

	async #drainLazyBatches(): Promise<void> {
		if (this.#lazyBatchActive) return;
		this.#lazyBatchActive = true;
		try {
			while (this.#pendingLazyIds.size > 0) {
				const { profileResolutionBatchSize } = getDeveloperSettingsSnapshot();
				const ids = [...this.#pendingLazyIds].slice(
					0,
					profileResolutionBatchSize,
				);
				ids.forEach((id) => this.#pendingLazyIds.delete(id));
				const token = this.#fetchToken;
				const lazyProfiles = ids.flatMap((id) => {
					const item = this.items.find((candidate) => candidate.id === id);
					return item?.type === "lazy" ? [item] : [];
				});
				if (lazyProfiles.length === 0) continue;
				try {
					const resolved = await resolveLazyProfiles(lazyProfiles);
					if (token !== this.#fetchToken) continue;
					for (const lazy of lazyProfiles) {
						const index = this.items.findIndex((item) => item.id === lazy.id);
						if (index === -1 || this.items[index].type !== "lazy") continue;
						const profile = resolved.get(lazy.id);
						if (profile) {
							this.#lazyRetryAttempts.delete(lazy.id);
							setCachedProfile(profile);
							this.items[index] = profile;
						} else {
							this.#lazyRetryAttempts.delete(lazy.id);
							this.items.splice(index, 1);
						}
					}
				} catch (error) {
					console.error("Browse lazy-profile batch failed");
					if (
						!(
							error instanceof ApiError &&
							(error.kind === "RequestBlocked" ||
								error.kind === "RequestCooldown")
						)
					) {
						showErrorToast({ label: "Failed to load profiles", error });
					}
					this.#queueLazyRetries(
						lazyProfiles.map((profile) => profile.id),
						error,
						token,
					);
				}
			}
		} finally {
			this.#lazyBatchActive = false;
			if (this.#pendingLazyIds.size > 0) void this.#drainLazyBatches();
		}
	}

	#queueLazyRetries(
		ids: readonly number[],
		error: unknown,
		token: number,
	): void {
		if (token !== this.#fetchToken) return;
		for (const id of ids) {
			const item = this.items.find((candidate) => candidate.id === id);
			if (!item || item.type !== "lazy") continue;
			const attempts = this.#lazyRetryAttempts.get(id) ?? 0;
			if (attempts >= MAX_LAZY_RETRY_ATTEMPTS) continue;
			this.#lazyRetryAttempts.set(id, attempts + 1);
			this.#lazyRetryIds.add(id);
		}
		if (this.#lazyRetryIds.size === 0) return;

		const retryAt = Date.now() + lazyRetryDelay(error);
		this.#lazyRetryAt = Math.max(this.#lazyRetryAt, retryAt);
		if (this.#lazyRetryTimer !== null) clearTimeout(this.#lazyRetryTimer);
		this.#lazyRetryTimer = setTimeout(
			() => {
				this.#lazyRetryTimer = null;
				this.#lazyRetryAt = 0;
				if (token !== this.#fetchToken) {
					this.#lazyRetryIds.clear();
					return;
				}
				for (const id of this.#lazyRetryIds) {
					const item = this.items.find((candidate) => candidate.id === id);
					if (item?.type === "lazy") this.#pendingLazyIds.add(id);
				}
				this.#lazyRetryIds.clear();
				void this.#drainLazyBatches();
			},
			Math.max(this.#lazyRetryAt - Date.now(), 0),
		);
	}

	async #fetchProfiles(
		geohash: string,
		opts?: { silent?: boolean },
	): Promise<void> {
		const token = this.#fetchToken;
		try {
			await this.filters.ready;
			if (token !== this.#fetchToken) return;
			const filters = this.filters.value;
			const query = {
				nearbyGeoHash: geohash,
				favorites: filters?.isFavorite || undefined,
				onlineOnly: filters?.isOnline || undefined,
				rightNow: filters?.isRightNow || undefined,
				...(filters?.ageEnabled && {
					ageMin: filters?.age[0],
					ageMax: filters?.age[1],
				}),
				...(filters?.genderEnabled && {
					genders: filters?.genders,
				}),
				...(filters?.positionEnabled && {
					sexualPositions: filters?.positions,
				}),
				...(filters?.photosEnabled &&
					filters?.photos.includes("has-photos") && {
						photoOnly: true,
					}),
				...(filters?.photosEnabled &&
					filters?.photos.includes("has-albums") && {
						hasAlbum: true,
					}),
				...(filters?.photosEnabled &&
					filters?.photos.includes("has-face-pics") && {
						faceOnly: true,
					}),
				...(filters?.tribesEnabled && {
					tribes: filters?.tribes,
				}),
				...(filters?.bodyTypesEnabled && {
					bodyTypes: filters?.bodyTypes,
				}),
				...(filters?.heightEnabled && {
					heightCmMin: filters?.height[0],
					heightCmMax: filters?.height[1],
				}),
				...(filters?.weightEnabled && {
					weightGramsMin: filters?.weight[0] * 1000,
					weightGramsMax: filters?.weight[1] * 1000,
				}),
				...(filters?.relationshipStatusesEnabled && {
					relationshipStatuses: filters?.relationshipStatuses,
				}),
				...(filters?.acceptNSFWPicsEnabled &&
					filters?.acceptNSFWPics !== undefined && {
						nsfwPics: filters?.acceptNSFWPics,
					}),
				...(filters?.lookingForEnabled && {
					lookingFor: filters?.lookingFor,
				}),
				...(filters?.meetAtEnabled && {
					meetAt: filters?.meetAt,
				}),
				notRecentlyChatted: filters?.haventChattedTodayEnabled || undefined,
				...(filters?.healthPracticesEnabled && {
					sexualHealth: filters?.healthPractices,
				}),
				...(filters?.tagsEnabled &&
					filters?.tags && {
						tags: filters?.tags,
					}),
				fresh: filters?.isFresh || undefined,
			} satisfies z.infer<typeof cascadeV4QuerySchema>;
			if (!opts?.silent && this.items.length === 0) {
				const cached = await readCachedGrid(query).catch(() => {
					console.error("Browse cache hydration failed");
					reportClientDiagnostic({
						category: "cache_recovery",
						component: "browse_grid",
						code: "bypassed_unreadable_cache",
						level: "warning",
					});
					return null;
				});
				if (token !== this.#fetchToken) return;
				if (cached) {
					this.currentQuery = cached.query;
					this.items = cached.items;
					this.nextPage = cached.nextPage;
					this.loading = false;
				}
			}
			const result = await getGrid(query);
			if (token !== this.#fetchToken) return;
			this.currentQuery = query;
			this.#pendingLazyIds.clear();
			this.items = result.items;
			this.nextPage = result.nextPage;
			void writeCachedGrid({
				query,
				items: result.items,
				nextPage: result.nextPage,
			}).catch(() => {
				console.error("Browse cache persistence failed");
			});
			this.error = null;
			this.loading = false;
			this.refreshing = false;
		} catch (err) {
			if (token !== this.#fetchToken) return;
			console.error("Browse refresh request failed");
			if (opts?.silent || this.items.length > 0) {
				this.error = null;
				showErrorToast({
					label: "Failed to refresh profiles",
					error: err,
				});
			} else {
				this.error =
					err instanceof Error
						? err
						: new Error("Failed to fetch profiles", { cause: err });
			}
			this.loading = false;
			this.refreshing = false;
		}
	}
}

function lazyRetryDelay(error: unknown): number {
	if (
		error instanceof ApiError &&
		(error.kind === "RequestCooldown" || error.kind === "RequestBlocked")
	) {
		const retryAtMs = retryAtFromCause(error.cause);
		if (retryAtMs !== null) return Math.max(retryAtMs - Date.now(), 0);
		return getDeveloperSettingsSnapshot().apiProtectionCooldownMs;
	}
	return getDeveloperSettingsSnapshot().reconcileThrottleMs;
}

function retryAtFromCause(cause: unknown): number | null {
	if (typeof cause !== "object" || cause === null || !("message" in cause)) {
		return null;
	}
	const message = cause.message;
	if (
		typeof message !== "object" ||
		message === null ||
		!("retryAtMs" in message) ||
		typeof message.retryAtMs !== "number" ||
		!Number.isFinite(message.retryAtMs)
	) {
		return null;
	}
	return message.retryAtMs;
}

export const gridState = new GridState();

registerAccountCache(() => gridState.reset());
