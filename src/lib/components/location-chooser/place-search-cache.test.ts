import { describe, expect, it } from "vitest";

import { PlaceSearchCache } from "./place-search-cache";

describe("PlaceSearchCache", () => {
	it("normalizes queries and evicts the least recently used result", () => {
		const cache = new PlaceSearchCache<number>(2);
		cache.set(" Dublin ", 1);
		cache.set("Cork", 2);
		expect(cache.get("DUBLIN")).toBe(1);
		cache.set("Galway", 3);

		expect(cache.get("cork")).toBeUndefined();
		expect(cache.get("dublin")).toBe(1);
		expect(cache.get("galway")).toBe(3);
	});

	it("shrinks immediately when capacity changes", () => {
		const cache = new PlaceSearchCache<number>(3);
		cache.set("one", 1);
		cache.set("two", 2);
		cache.set("three", 3);
		cache.setCapacity(1);

		expect(cache.get("one")).toBeUndefined();
		expect(cache.get("three")).toBe(3);
	});
});
