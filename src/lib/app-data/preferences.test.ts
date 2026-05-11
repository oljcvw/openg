import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_DATA_FILES } from "$lib/app-data/preferences.svelte";

type CapabilityPermission = {
	allow?: Array<{ path?: string }>;
};

function hasAllowList(permission: unknown): permission is CapabilityPermission {
	return (
		typeof permission === "object" &&
		permission !== null &&
		"allow" in permission
	);
}

describe("preferences app data permissions", () => {
	it("allow the same preferences file that the app reads and writes", () => {
		const capability = JSON.parse(
			readFileSync(
				new URL("../../../src-tauri/capabilities/default.json", import.meta.url),
				"utf8",
			),
		) as { permissions: unknown[] };

		const allowedPaths = capability.permissions
			.filter(hasAllowList)
			.flatMap((permission) => permission.allow?.map(({ path }) => path) ?? []);

		expect(allowedPaths).toContain(`$APPDATA/${APP_DATA_FILES.preferences}`);
	});
});
