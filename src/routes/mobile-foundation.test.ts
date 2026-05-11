import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("mobile app shell", () => {
	it("opts into edge-to-edge viewport layout for Android safe areas", () => {
		const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");

		expect(appHtml).toContain(
			'name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"',
		);
	});

	it("defines reusable safe-area spacing variables", () => {
		const layoutCss = readFileSync(
			new URL("../layout.css", import.meta.url),
			"utf8",
		);

		expect(layoutCss).toContain("--safe-area-inset-top: env(safe-area-inset-top, 0px)");
		expect(layoutCss).toContain(
			"--safe-area-inset-bottom: env(safe-area-inset-bottom, 0px)",
		);
		expect(layoutCss).toContain(".pb-safe");
	});
});
