import { describe, expect, it } from "vitest";

import { AccountTtlLru } from "$lib/util/account-ttl-lru";

describe("AccountTtlLru", () => {
	it("expires on access, promotes reads, and clears across account generations", () => {
		let now = 0;
		const cache = new AccountTtlLru<string>({
			capacity: () => 2,
			ttlMs: 10,
			now: () => now,
		});
		cache.setAccount(1, 1);
		cache.set("a", "A");
		cache.set("b", "B");
		expect(cache.get("a")).toBe("A");
		cache.set("c", "C");
		expect(cache.get("b")).toBeNull();
		now = 11;
		expect(cache.get("a")).toBeNull();
		expect(cache.size).toBe(1);
		cache.setAccount(2, 2);
		expect(cache.size).toBe(0);
	});

	it("keeps a deterministic 10,000-entry workload within its configured bound", () => {
		const cache = new AccountTtlLru<number>({
			capacity: () => 500,
			ttlMs: 60_000,
			now: () => 1,
		});
		cache.setAccount(1, 1);
		for (let index = 0; index < 10_000; index += 1) cache.set(index, index);
		expect(cache.size).toBe(500);
		expect(cache.get(9_499)).toBeNull();
		expect(cache.get(9_500)).toBe(9_500);
	});
});
