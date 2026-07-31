import { describe, expect, it } from "vitest";

import { getErrorText } from "$lib/api/error";
import { albumMediaLoadError } from "./album-media-error";

describe("albumMediaLoadError", () => {
	it("does not expose a signed media URL in copyable error details", () => {
		const privateUrl = "https://media.example/private.jpg?token=super-secret";
		const error = albumMediaLoadError("image");

		expect(getErrorText(error)).not.toContain(privateUrl);
		expect(getErrorText(error)).not.toContain("super-secret");
		expect(error.cause).toBeUndefined();
	});
});
