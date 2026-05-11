import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const tauriConfig = JSON.parse(
	readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

const defaultCapability = JSON.parse(
	readFileSync(
		new URL("../../../src-tauri/capabilities/default.json", import.meta.url),
		"utf8",
	),
);

describe("privacy and security release gates", () => {
	it("keeps Tauri content security policy enabled", () => {
		expect(tauriConfig.app.security.csp).toEqual(expect.any(String));
		expect(tauriConfig.app.security.csp).toContain("default-src 'self'");
		expect(tauriConfig.app.security.csp).not.toContain("http:");
	});

	it("does not grant broad filesystem permissions", () => {
		expect(defaultCapability.permissions).not.toContain("fs:default");
		expect(defaultCapability.permissions).not.toContain("fs:allow-app-read");
		expect(defaultCapability.permissions).not.toContain("fs:allow-app-write");
	});

	it("limits filesystem access to app data and cache scopes", () => {
		const scopedFsPermissions = defaultCapability.permissions.filter(
			(permission: unknown) =>
				typeof permission === "object" &&
				"identifier" in permission &&
				String(permission.identifier).startsWith("fs:"),
		);

		expect(scopedFsPermissions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					identifier: "fs:allow-app-read",
					allow: [{ path: "$APPDATA/preferences.data" }],
				}),
				expect.objectContaining({
					identifier: "fs:allow-app-write",
					allow: [{ path: "$APPDATA/preferences.data" }],
				}),
				expect.objectContaining({
					identifier: "fs:allow-exists",
					allow: [
						{ path: "$APPDATA/preferences.data" },
						{ path: "$APPCACHE/json-cache" },
						{ path: "$APPCACHE/json-cache/**" },
					],
				}),
				expect.objectContaining({
					identifier: "fs:allow-mkdir",
					allow: [{ path: "$APPDATA" }],
				}),
			]),
		);
	});
});
