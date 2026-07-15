import { describe, expect, it } from "vitest";
import z from "zod";

import { encode, decode } from "@msgpack/msgpack";

// Replicate persistence migration expectations around the new preference field.
const preferencesSchema = z.object({
	geohash: z.string().nullable().default(null),
	revealMessageRead: z.boolean().default(false),
	revealProfileViews: z.boolean().default(false),
	showLastOnlineOverlay: z.boolean().default(true),
	units: z.enum(["metric", "imperial"]).default("metric"),
	warnBeforeCopyingErrorDetails: z.boolean().default(true),
});

describe("showLastOnlineOverlay preference", () => {
	it("defaults to true for empty preference objects", () => {
		expect(preferencesSchema.parse({}).showLastOnlineOverlay).toBe(true);
	});

	it("defaults to true when older preference blobs omit the field", () => {
		const legacyBytes = encode({
			geohash: null,
			revealMessageRead: false,
			revealProfileViews: false,
			units: "metric",
			warnBeforeCopyingErrorDetails: true,
		});
		const parsed = preferencesSchema.parse(decode(legacyBytes));
		expect(parsed.showLastOnlineOverlay).toBe(true);
	});

	it("preserves an explicit false value", () => {
		expect(
			preferencesSchema.parse({ showLastOnlineOverlay: false })
				.showLastOnlineOverlay,
		).toBe(false);
	});
});
