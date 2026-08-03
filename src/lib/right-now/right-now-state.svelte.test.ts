import { describe, expect, it, vi } from "vitest";

const { showErrorToastMock } = vi.hoisted(() => ({
	showErrorToastMock: vi.fn(),
}));

vi.mock("$lib/api/error", () => ({ showErrorToast: showErrorToastMock }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getPreferences: vi.fn(() => Promise.resolve({})),
	setPreferences: vi.fn(() => Promise.resolve(undefined)),
}));

import {
	defaultRightNowFilters,
	type RightNowFilters,
} from "$lib/components/filters/filters";
import type { FeedPost, FeedSnapshot } from "./posts";
import { RightNowSearchFiltersState } from "./right-now-filters-state.svelte";
import { RightNowState } from "./right-now-state.svelte";

function post(id: number, expiration = 10_000): FeedPost {
	return {
		displayName: `Profile ${id}`,
		distance: null,
		expiration,
		hosting: false,
		id,
		media: [],
		mediaHash: null,
		onlineUntil: null,
		posted: id,
		profileId: id + 100,
		text: null,
	};
}

function filters(value: Partial<RightNowFilters> = {}) {
	return new RightNowSearchFiltersState({
		onRefresh: vi.fn(),
		persistence: {
			load: () => Promise.resolve({ ...defaultRightNowFilters, ...value }),
			save: () => Promise.resolve(),
		},
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe("RightNowState", () => {
	it("loads the hydrated filter query and progressively reveals posts", async () => {
		const loader = vi.fn().mockResolvedValue({
			posts: Array.from({ length: 25 }, (_, index) => post(index + 1)),
			viewerCount: 42,
		});
		const state = new RightNowState({
			loader,
			filters: filters({
				sort: "NEWEST",
				hosting: false,
				ageEnabled: true,
				age: [25, 40],
				positionEnabled: true,
				positions: [1, 3],
			}),
		});

		await state.load();

		expect(loader).toHaveBeenCalledWith({
			sort: "NEWEST",
			hosting: false,
			ageMin: 25,
			ageMax: 40,
			sexualPositions: [1, 3],
		});
		expect(state.viewerCount).toBe(42);
		expect(state.visiblePosts(1_000)).toHaveLength(12);
		expect(state.hasMore(1_000)).toBe(true);

		state.loadMore();

		expect(state.visiblePosts(1_000)).toHaveLength(24);
	});

	it("removes expired posts from the visible snapshot", async () => {
		const state = new RightNowState({
			loader: () =>
				Promise.resolve({
					posts: [post(1, 1_500), post(2, 2_500)],
					viewerCount: 0,
				}),
			filters: filters(),
		});
		await state.load();

		expect(state.visiblePosts(1_000)).toHaveLength(2);
		expect(state.visiblePosts(2_000).map(({ id }) => id)).toEqual([2]);
		expect(state.visiblePosts(3_000)).toHaveLength(0);
	});

	it("records an initial failure and succeeds on retry", async () => {
		const loader = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ posts: [post(1)], viewerCount: 1 });
		const state = new RightNowState({ loader, filters: filters() });

		await state.load();
		expect(state.error?.message).toBe("offline");

		await state.retry();
		expect(state.error).toBeNull();
		expect(state.visiblePosts(0)).toHaveLength(1);
	});

	it("keeps the newest request when an older request resolves late", async () => {
		const first = deferred<FeedSnapshot>();
		const second = deferred<FeedSnapshot>();
		const loader = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const state = new RightNowState({ loader, filters: filters() });

		const firstLoad = state.load();
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
		const retry = state.retry();
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));

		second.resolve({ posts: [post(2)], viewerCount: 2 });
		await retry;
		first.resolve({ posts: [post(1)], viewerCount: 1 });
		await firstLoad;

		expect(state.viewerCount).toBe(2);
		expect(state.visiblePosts(0).map(({ id }) => id)).toEqual([2]);
	});

	it("keeps existing posts and reports a background refresh failure", async () => {
		const loader = vi
			.fn()
			.mockResolvedValueOnce({ posts: [post(1)], viewerCount: 1 })
			.mockRejectedValueOnce(new Error("refresh failed"));
		const state = new RightNowState({ loader, filters: filters() });
		await state.load();

		await state.refresh();

		expect(state.visiblePosts(0).map(({ id }) => id)).toEqual([1]);
		expect(showErrorToastMock).toHaveBeenCalledWith({
			label: "Failed to refresh Right Now feed",
			error: expect.any(Error),
		});
	});
});
