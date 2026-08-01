import { describe, expect, it } from "vitest";

import { parseProfileCache } from "$lib/app-data/profile-cache";

describe("profile cache schema", () => {
	it("adds defaults for a new cache", () => {
		expect(parseProfileCache({})).toEqual({ version: 1, accounts: {} });
	});

	it("rejects cache entries without account isolation", () => {
		expect(() =>
			parseProfileCache({ version: 1, profiles: { "123": {} } }),
		).not.toThrow();
		expect(parseProfileCache({ version: 1, profiles: { "123": {} } })).toEqual({
			version: 1,
			accounts: {},
		});
	});

	it("rejects unknown cache versions", () => {
		expect(() => parseProfileCache({ version: 2, accounts: {} })).toThrow();
	});
});
