import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/api/error", () => ({ showErrorToast: vi.fn() }));

import {
	defaultRightNowFilters,
	type RightNowFilters,
} from "$lib/components/filters/filters";
import { RightNowSearchFiltersState } from "./right-now-filters-state.svelte";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("RightNowSearchFiltersState", () => {
	it("does not overwrite a user change when hydration resolves later", async () => {
		const load = deferred<RightNowFilters | undefined>();
		const save = vi.fn().mockResolvedValue(undefined);
		const onRefresh = vi.fn();
		const state = new RightNowSearchFiltersState({
			onRefresh,
			persistence: { load: () => load.promise, save },
		});

		state.set({ sort: "NEWEST" });
		load.resolve({ ...defaultRightNowFilters, sort: "DISTANCE" });
		await state.ready;

		expect(state.value?.sort).toBe("NEWEST");
		expect(onRefresh).toHaveBeenCalledOnce();
		await vi.waitFor(() =>
			expect(save).toHaveBeenCalledWith(
				expect.objectContaining({ sort: "NEWEST" }),
			),
		);
	});

	it("uses defaults when no saved filters exist", async () => {
		const state = new RightNowSearchFiltersState({
			onRefresh: vi.fn(),
			persistence: {
				load: () => Promise.resolve(undefined),
				save: () => Promise.resolve(),
			},
		});

		await state.ready;

		expect(state.value).toEqual(defaultRightNowFilters);
	});
});
