import { describe, expect, it } from "vitest";

import { ApiError } from "$lib/api/api-error";

describe("ApiError block diagnostics", () => {
	it("redacts bodies, identifiers, and query values", () => {
		const error = new ApiError({
			message: "Grindr temporarily refused this request",
			kind: "RequestBlocked",
			request: {
				method: "GET",
				path: "/v5/chat/conversation/4cc8e8e3-3f67-4aa2-838c-d853aed499ef/message?pageKey=secret",
				body: { token: "secret" },
			},
			response: { status: 403, body: "private Cloudflare response" },
		});

		const copied = error.copyableText();
		expect(copied).toContain("/v5/chat/conversation/<id>/message?pageKey");
		expect(copied).not.toContain("4cc8e8e3");
		expect(copied).not.toContain("secret");
		expect(copied).not.toContain("private Cloudflare response");
	});
});
