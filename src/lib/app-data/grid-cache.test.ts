import { describe, expect, it } from "vitest";

import { parseGridCache } from "$lib/app-data/grid-cache";

describe("Browse cache schema", () => {
	it("adds defaults for a new cache", () => {
		expect(parseGridCache({})).toEqual({ version: 1, accounts: {} });
	});

	it("rejects unknown cache versions", () => {
		expect(() => parseGridCache({ version: 2, accounts: {} })).toThrow();
	});
});
