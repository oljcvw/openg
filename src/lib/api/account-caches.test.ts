import { describe, expect, it, vi } from "vitest";

import {
	activateAccountSession,
	getAccountSessionSnapshot,
	invalidateAccountSession,
	isAccountSessionCurrent,
	registerAccountCache,
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
});
