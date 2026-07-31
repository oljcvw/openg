import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SIGNED_MEDIA_ORIGIN = "https://d2wxe7lth7kp8g.cloudfront.net";

function directives(csp: string): Map<string, string[]> {
	return new Map(
		csp.split(";").map((directive) => {
			const [name, ...sources] = directive.trim().split(/\s+/);
			return [name, sources];
		}),
	);
}

describe("remote media content security policy", () => {
	it("allows Grindr's exact signed-media origin for images and media", () => {
		const config = JSON.parse(
			readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
		) as { app: { security: { csp: string } } };
		const csp = directives(config.app.security.csp);

		expect(csp.get("img-src")).toContain(SIGNED_MEDIA_ORIGIN);
		expect(csp.get("media-src")).toContain(SIGNED_MEDIA_ORIGIN);
		expect(config.app.security.csp).not.toContain("https://*.cloudfront.net");
	});
});
