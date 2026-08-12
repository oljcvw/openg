import { describe, expect, it, vi } from "vitest";

import {
	activateAccountSession,
	getAccountSessionSnapshot,
	invalidateAccountSession,
	isAccountSessionCurrent,
	registerAccountCache,
	subscribeAccountGeneration,
} from "$lib/api/account-caches";

describe("account session generation", () => {
	it("invalidates prior work before activating another account", () => {
		const reset = vi.fn();
		registerAccountCache(reset);
		const first = activateAccountSession(101);
		reset.mockClear();

		const second = activateAccountSession(202);

		expect(isAccountSessionCurrent(first)).toBe(false);
		expect(isAccountSessionCurrent(second)).toBe(true);
		expect(getAccountSessionSnapshot().accountId).toBe(202);
		expect(reset).toHaveBeenCalledOnce();
	});

	it("returns the account being invalidated for ordered deletion", () => {
		activateAccountSession(303);

		const previous = invalidateAccountSession();

		expect(previous.accountId).toBe(303);
		expect(isAccountSessionCurrent(previous)).toBe(false);
		expect(getAccountSessionSnapshot().accountId).toBeNull();
	});

	it("notifies generation subscribers without exposing account identifiers", () => {
		const observed: number[] = [];
		const release = subscribeAccountGeneration((generation) => {
			observed.push(generation);
		});
		const initialGeneration = getAccountSessionSnapshot().generation;

		activateAccountSession(987_654_321);
		invalidateAccountSession();
		release();
		activateAccountSession(123_456_789);

		expect(observed).toEqual([
			initialGeneration,
			initialGeneration + 1,
			initialGeneration + 2,
		]);
		expect(JSON.stringify(observed)).not.toContain("987654321");
	});
});
