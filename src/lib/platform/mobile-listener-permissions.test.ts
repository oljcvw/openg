import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pluginIdentities = [
	"open-grind-voice-recorder",
	"open-grind-video-call",
	"open-grind-notifications",
] as const;

describe("custom mobile listener permissions", () => {
	it("grants all three listener-only plugin defaults through shared mobile ACL", () => {
		const mobile = JSON.parse(
			readFileSync("src-tauri/capabilities/mobile.json", "utf8"),
		) as { permissions: string[] };
		const android = JSON.parse(
			readFileSync("src-tauri/capabilities/android.json", "utf8"),
		) as { permissions: string[] };
		for (const plugin of pluginIdentities) {
			expect(mobile.permissions).toContain(`${plugin}:default`);
			expect(android.permissions).not.toContain(`${plugin}:default`);
		}
	});

	it("generates metadata with only listener registration and removal commands", () => {
		const build = readFileSync("src-tauri/build.rs", "utf8");
		for (const plugin of pluginIdentities)
			expect(build).toContain(`.plugin("${plugin}", listener_plugin())`);
		expect(build.match(/\.commands\(&\[([^\]]+)\]\)/)?.[1]).toBe(
			'"register_listener", "remove_listener"',
		);
		expect(build.match(/\.plugin\("open-grind-/g)).toHaveLength(3);
	});
});
