import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "$lib/api/api-error";

const {
	getGrid,
	readCachedGrid,
	resolveLazyProfiles,
	showErrorToast,
	writeCachedGrid,
} = vi.hoisted(() => ({
	getGrid: vi.fn(),
	readCachedGrid: vi.fn(),
	resolveLazyProfiles: vi.fn(),
	showErrorToast: vi.fn(),
	writeCachedGrid: vi.fn(),
}));

vi.mock("$lib/api/account-caches", () => ({ registerAccountCache: vi.fn() }));
vi.mock("$lib/api/error", () => ({ showErrorToast }));
vi.mock("$lib/app-data/grid-cache", () => ({
	readCachedGrid,
	writeCachedGrid,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: vi.fn(() => ({
		apiRequestTimeoutMs: 35_000,
		apiProtectionCooldownMs: 30_000,
		profileResolutionBatchSize: 2,
		profileResolutionWindowMs: 0,
		reconcileThrottleMs: 2_000,
	})),
	getPreferences: vi.fn().mockResolvedValue({ gridSearchFilters: null }),
	setPreferences: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./grid", () => ({
	getCachedProfile: vi.fn().mockReturnValue(null),
	getGrid,
	resolveLazyProfiles,
	setCachedProfile: vi.fn(),
}));

import { GridState } from "./grid-state.svelte";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});
	return { promise, resolve };
}

function page(id: number, nextPage: number | null = null) {
	return {
		items: [
			{
				type: "rendered" as const,
				id,
				displayName: `Profile ${id}`,
				distance: null,
				profilePhotosHashes: null,
				unread: null,
				onlineUntil: null,
				isFavorite: false,
				isRightNow: false,
				isVisiting: false,
				hasChattedInLast24Hrs: false,
			},
		],
		nextPage,
		shuffled: false,
	};
}

beforeEach(() => {
	getGrid.mockReset();
	readCachedGrid.mockReset().mockResolvedValue(null);
	writeCachedGrid.mockReset().mockResolvedValue(undefined);
	showErrorToast.mockReset();
	resolveLazyProfiles
		.mockReset()
		.mockImplementation((profiles) =>
			Promise.resolve(
				new Map(
					profiles.map((profile: { id: number }) => [
						profile.id,
						page(profile.id).items[0],
					]),
				),
			),
		);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("GridState profile resolution", () => {
	it("uses configured profile batch size", async () => {
		vi.useFakeTimers();
		const state = new GridState();
		await state.filters.ready;
		state.items = [1, 2, 3].map((id) => ({
			type: "lazy" as const,
			id,
			unread: null,
			isVisiting: false,
		}));

		await Promise.all([
			state.resolveProfile(1),
			state.resolveProfile(2),
			state.resolveProfile(3),
		]);
		await vi.runAllTimersAsync();

		expect(
			resolveLazyProfiles.mock.calls.map(([profiles]) => profiles.length),
		).toEqual([2, 1]);
	});

	it("retries failed current lazy profiles after a bounded delay", async () => {
		vi.useFakeTimers();
		resolveLazyProfiles
			.mockRejectedValueOnce(new Error("temporary"))
			.mockImplementationOnce((profiles) =>
				Promise.resolve(
					new Map(
						profiles.map((profile: { id: number }) => [
							profile.id,
							page(profile.id).items[0],
						]),
					),
				),
			);
		const state = new GridState();
		await state.filters.ready;
		state.items = [
			{ type: "lazy" as const, id: 1, unread: null, isVisiting: false },
		];

		await state.resolveProfile(1);
		await vi.advanceTimersByTimeAsync(0);
		expect(resolveLazyProfiles).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(1_999);
		expect(resolveLazyProfiles).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);

		expect(resolveLazyProfiles).toHaveBeenCalledTimes(2);
		expect(state.items[0]).toMatchObject({ type: "rendered", id: 1 });
	});

	it("honors native cooldown timing before retrying", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		resolveLazyProfiles.mockRejectedValueOnce(
			new ApiError({
				message: "paused",
				request: { method: "POST", path: "/v3/profiles" },
				kind: "RequestCooldown",
				cause: { message: { retryAtMs: 5_000 } },
			}),
		);
		const state = new GridState();
		await state.filters.ready;
		state.items = [
			{ type: "lazy" as const, id: 1, unread: null, isVisiting: false },
		];

		await state.resolveProfile(1);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(resolveLazyProfiles).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);

		expect(resolveLazyProfiles).toHaveBeenCalledTimes(2);
		expect(showErrorToast).not.toHaveBeenCalled();
	});

	it("does not retry a lazy profile removed from the current grid", async () => {
		vi.useFakeTimers();
		resolveLazyProfiles.mockRejectedValueOnce(new Error("temporary"));
		const state = new GridState();
		await state.filters.ready;
		state.items = [
			{ type: "lazy" as const, id: 1, unread: null, isVisiting: false },
		];

		await state.resolveProfile(1);
		await vi.advanceTimersByTimeAsync(0);
		state.items = page(2).items;
		await vi.advanceTimersByTimeAsync(2_000);

		expect(resolveLazyProfiles).toHaveBeenCalledOnce();
		expect(state.items[0]).toMatchObject({ type: "rendered", id: 2 });
	});

	it("caps automatic retries for a persistently failing lazy profile", async () => {
		vi.useFakeTimers();
		resolveLazyProfiles.mockRejectedValue(new Error("temporary"));
		const state = new GridState();
		await state.filters.ready;
		state.items = [
			{ type: "lazy" as const, id: 1, unread: null, isVisiting: false },
		];

		await state.resolveProfile(1);
		await vi.advanceTimersByTimeAsync(20_000);

		expect(resolveLazyProfiles).toHaveBeenCalledTimes(3);
		expect(state.items[0]).toMatchObject({ type: "lazy", id: 1 });
	});
});

describe("GridState Cascade coordination", () => {
	it("falls back to the network when the disk cache cannot be read", async () => {
		readCachedGrid.mockRejectedValueOnce(new Error("corrupt cache"));
		getGrid.mockResolvedValueOnce(page(1));
		const state = new GridState();
		await state.filters.ready;

		state.load("first");

		await vi.waitFor(() => expect(state.items).toHaveLength(1));
		expect(getGrid).toHaveBeenCalledOnce();
		expect(state.error).toBeNull();
	});

	it("serializes requests and applies only the newest location", async () => {
		const first = deferred<ReturnType<typeof page>>();
		getGrid.mockImplementationOnce(() => first.promise);
		getGrid.mockResolvedValueOnce(page(2));
		const state = new GridState();
		await state.filters.ready;

		state.load("first");
		await vi.waitFor(() => expect(getGrid).toHaveBeenCalledTimes(1));
		state.load("superseded");
		state.load("latest");
		expect(getGrid).toHaveBeenCalledTimes(1);

		first.resolve(page(1));
		await vi.waitFor(() => expect(getGrid).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(state.items.map((item) => item.id)).toEqual([2]),
		);
		expect(getGrid.mock.calls[1][0]).toMatchObject({ nearbyGeoHash: "latest" });
		expect(getGrid.mock.calls.map(([query]) => query.nearbyGeoHash)).toEqual([
			"first",
			"latest",
		]);
	});

	it("lets callers await the coalesced load-more request", async () => {
		getGrid.mockResolvedValueOnce(page(1, 2));
		const next = deferred<ReturnType<typeof page>>();
		getGrid.mockImplementationOnce(() => next.promise);
		const state = new GridState();
		await state.filters.ready;
		state.load("first");
		await vi.waitFor(() => expect(state.items).toHaveLength(1));

		let completed = false;
		const loading = state.loadMore().then(() => {
			completed = true;
		});
		await vi.waitFor(() => expect(getGrid).toHaveBeenCalledTimes(2));
		expect(completed).toBe(false);

		next.resolve(page(2));
		await loading;
		expect(state.items.map((item) => item.id)).toEqual([1, 2]);
	});

	it("shares one page request between concurrent load-more callers", async () => {
		getGrid.mockResolvedValueOnce(page(1, 2));
		const next = deferred<ReturnType<typeof page>>();
		getGrid.mockImplementationOnce(() => next.promise);
		const state = new GridState();
		await state.filters.ready;
		state.load("first");
		await vi.waitFor(() => expect(state.items).toHaveLength(1));

		const first = state.loadMore();
		const second = state.loadMore();
		await vi.waitFor(() => expect(getGrid).toHaveBeenCalledTimes(2));
		next.resolve(page(2, 3));
		await Promise.all([first, second]);

		expect(getGrid).toHaveBeenCalledTimes(2);
		expect(state.items.map((item) => item.id)).toEqual([1, 2]);
		expect(state.nextPage).toBe(3);
	});
});
