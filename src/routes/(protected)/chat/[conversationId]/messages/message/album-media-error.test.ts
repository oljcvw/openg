import { describe, expect, it } from "vitest";

import { albumMediaLoadError } from "./album-media-error";

describe("albumMediaLoadError", () => {
	it("builds a kind-only copyable message with no cause", () => {
		for (const kind of ["image", "video"] as const) {
			const error = albumMediaLoadError(kind);
			expect(error.message).toBe(`Failed to load album ${kind}`);
			expect(error.cause).toBeUndefined();
		}
	});
});
