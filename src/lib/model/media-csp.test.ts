import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SIGNED_MEDIA_SOURCE = "https://*.cloudfront.net";
const DIRECT_MEDIA_SOURCES = [
	"direct-media-cache:",
	"http://direct-media-cache.localhost",
];

function directives(csp: string): Map<string, string[]> {
	return new Map(
		csp.split(";").map((directive) => {
			const [name, ...sources] = directive.trim().split(/\s+/);
			return [name ?? "", sources];
		}),
	);
}

describe("remote media content security policy", () => {
	it("limits CloudFront wildcard access to image and media loading", () => {
		const config = JSON.parse(
			readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
		) as { app: { security: { csp: string } } };
		const csp = directives(config.app.security.csp);

		expect(csp.get("img-src")).toContain(SIGNED_MEDIA_SOURCE);
		expect(csp.get("media-src")).toContain(SIGNED_MEDIA_SOURCE);
		for (const [directive, sources] of csp) {
			if (directive === "img-src" || directive === "media-src") continue;
			expect(sources, directive).not.toContain(SIGNED_MEDIA_SOURCE);
		}
	});

	it("permits encrypted direct-media protocol URLs only as media sources", () => {
		const config = JSON.parse(
			readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
		) as { app: { security: { csp: string } } };
		const csp = directives(config.app.security.csp);

		for (const source of DIRECT_MEDIA_SOURCES) {
			expect(csp.get("img-src")).toContain(source);
			expect(csp.get("media-src")).toContain(source);
			for (const [directive, sources] of csp) {
				if (directive === "img-src" || directive === "media-src") continue;
				expect(sources, `${directive} must not allow ${source}`).not.toContain(
					source,
				);
			}
		}
	});
});
