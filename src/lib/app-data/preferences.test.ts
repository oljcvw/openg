import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_DATA_FILES } from "$lib/app-data/preferences.svelte";

describe("preferences app data permissions", () => {
	it("allow the same preferences file that the app reads and writes", () => {
		const capability = JSON.parse(
			readFileSync(
				new URL("../../../src-tauri/capabilities/default.json", import.meta.url),
				"utf8",
			),
		);

		const allowedPaths = capability.permissions
			.filter((permission: unknown) => typeof permission === "object")
			.flatMap((permission: { allow?: Array<{ path?: string }> }) =>
				permission.allow?.map(({ path }) => path) ?? [],
			);

		expect(allowedPaths).toContain(`$APPDATA/${APP_DATA_FILES.preferences}`);
	});
});
