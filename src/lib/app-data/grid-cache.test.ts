import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
	normalizePersistedGridQuery,
	parseGridCache,
} from "$lib/app-data/grid-cache";

describe("Browse cache schema", () => {
	it("adds defaults for a new cache", () => {
		expect(parseGridCache({})).toEqual({ version: 1, accounts: {} });
	});

	it("rejects unknown cache versions", () => {
		expect(() => parseGridCache({ version: 2, accounts: {} })).toThrow();
	});

	it("hydrates legacy null optional query properties without deleting profiles", () => {
		const parsed = parseGridCache({
			version: 1,
			accounts: {
				"42": {
					legacy: {
						query: { nearbyGeoHash: "gc7x12345678", onlineOnly: null },
						items: [
							{
								type: "lazy",
								id: 7,
								unread: null,
								isVisiting: false,
							},
						],
						nextPage: null,
						updatedAt: 1,
					},
				},
			},
		});

		expect(parsed.accounts["42"]?.legacy?.query).toEqual({
			nearbyGeoHash: "gc7x12345678",
		});
		expect(parsed.accounts["42"]?.legacy?.items).toHaveLength(1);
	});

	it("omits absent query options before MessagePack encoding", () => {
		const query = normalizePersistedGridQuery({
			nearbyGeoHash: "gc7x12345678",
			onlineOnly: undefined,
		});
		expect(decode(encode(query))).toEqual({ nearbyGeoHash: "gc7x12345678" });
	});
});
