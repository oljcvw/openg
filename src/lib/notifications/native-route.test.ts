import { describe, expect, it } from "vitest";

import { acceptedNativeNotificationRoute } from "./native-route";

describe("acceptedNativeNotificationRoute", () => {
	it("accepts account-bound chat and taps routes", () => {
		expect(
			acceptedNativeNotificationRoute(
				{ route: "/chat/chat_7:abc", accountId: "42" },
				42,
			),
		).toEqual({ route: "/chat/chat_7:abc", accountId: "42" });
		expect(
			acceptedNativeNotificationRoute(
				{ route: "/interest/taps", accountId: "42" },
				42,
			),
		).not.toBeNull();
	});

	it("rejects stale-account, signed-out, and unsafe routes", () => {
		expect(
			acceptedNativeNotificationRoute(
				{ route: "/chat/private", accountId: "41" },
				42,
			),
		).toBeNull();
		expect(
			acceptedNativeNotificationRoute(
				{ route: "/chat/private", accountId: "42" },
				null,
			),
		).toBeNull();
		expect(
			acceptedNativeNotificationRoute(
				{ route: "/settings/account/delete", accountId: "42" },
				42,
			),
		).toBeNull();
	});
});
