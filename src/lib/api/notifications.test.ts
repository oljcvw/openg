import { describe, expect, it } from "vitest";

import { notificationSettingsSchema } from "$lib/api";

describe("notificationSettingsSchema", () => {
	it("accepts the native iOS permission prompt state", () => {
		expect(
			notificationSettingsSchema.parse({
				supported: true,
				enabled: false,
				messages: true,
				taps: true,
				showPreviews: false,
				permission: "prompt",
				lastSuccessfulCheck: null,
				lastError: null,
			}),
		).toMatchObject({ permission: "prompt" });
	});
});
