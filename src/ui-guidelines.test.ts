import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, root), "utf8");
}

describe("UI guideline fixes", () => {
	it("uses bounded button transitions", () => {
		const button = read("src/lib/components/ui/button/button.svelte");

		expect(button).not.toContain("transition-all");
		expect(button).toContain(
			"transition-[color,background-color,border-color,box-shadow,opacity,transform]",
		);
	});

	it("keeps the error page semantic and avoids nested links", () => {
		const errorPage = read("src/routes/+error.svelte");

		expect(errorPage).not.toContain('role="button"');
		expect(errorPage).not.toContain('tabindex="-1"');
		expect(errorPage).toContain('aria-label="Reveal Clippy help"');
		expect(errorPage).not.toContain("<Button variant=\"link\"");
		expect(errorPage).toContain("href=\"https://git.opengrind.org/open-grind/open-grind/issues/new");
	});

	it("adds explicit auth and composer field metadata", () => {
		const login = read("src/routes/auth/sign-in/LoginForm.svelte");
		const composer = read(
			"src/routes/(protected)/chat/[conversationId]/MessageComposer.svelte",
		);

		expect(login).toContain('name="email"');
		expect(login).toContain('autocomplete="email"');
		expect(login).toContain("spellcheck={false}");
		expect(composer).toContain('aria-label="Message text"');
		expect(composer).toContain('name="message"');
		expect(composer).toContain('autocomplete="off"');
		expect(composer).toContain('placeholder="Say something…"');
	});

	it("limits grid DOM work and preserves image dimensions", () => {
		const grid = read("src/routes/(protected)/(root)/Grid.svelte");
		const card = read("src/routes/(protected)/(root)/ProfileMiniCard.svelte");

		expect(grid).not.toContain("TODO: virtual list");
		expect(grid).toContain("visibleGridProfiles");
		expect(grid).toContain("topVirtualRows");
		expect(grid).toContain("bottomVirtualRows");
		expect(card).toContain('width="320"');
		expect(card).toContain('height="320"');
	});

	it("keeps text selectable while tuning touch behavior", () => {
		const layoutCss = read("src/layout.css");
		const rootBodyBlock = layoutCss.match(/:root,\nbody \{[\s\S]*?\n\}/)?.[0] ?? "";

		expect(rootBodyBlock).not.toContain("user-select");
		expect(rootBodyBlock).not.toContain("-webkit-user-select");
		expect(layoutCss).toContain("touch-action: manipulation");
		expect(layoutCss).toContain("-webkit-tap-highlight-color");
	});

	it("uses locale-aware distance formatting", () => {
		const utils = read("src/lib/utils.ts");
		const distance = read("src/routes/(protected)/profile/[profileId]/Distance.svelte");
		const card = read("src/routes/(protected)/(root)/ProfileMiniCard.svelte");

		expect(utils).toContain("export function formatMetricDistance");
		expect(utils).toContain("Intl.NumberFormat");
		expect(distance).not.toContain("toFixed");
		expect(distance).toContain("formatMetricDistance");
		expect(card).toContain("formatMetricDistance");
	});

	it("removes generated Android placeholder UI", () => {
		const androidLayout = read(
			"src-tauri/gen/android/app/src/main/res/layout/activity_main.xml",
		);

		expect(androidLayout).not.toContain("Hello World!");
		expect(androidLayout).not.toContain("<TextView");
	});

	it("uses system-adaptive macOS window theming", () => {
		const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
			app: { windows: Array<{ theme?: string }> };
		};

		expect(tauriConfig.app.windows[0]).not.toHaveProperty("theme");
	});

	it("adds desktop navigation and keyboard affordances", () => {
		const protectedLayout = read("src/routes/(protected)/+layout.svelte");
		const navBar = read("src/lib/components/NavBar.svelte");

		expect(existsSync(new URL("src/lib/components/DesktopSidebar.svelte", root))).toBe(
			true,
		);
		expect(protectedLayout).toContain("DesktopSidebar");
		expect(navBar).toContain("md:hidden");

		const desktopSidebar = read("src/lib/components/DesktopSidebar.svelte");
		expect(desktopSidebar).toContain('aria-label="Primary navigation"');
		expect(desktopSidebar).toContain("event.metaKey");
		expect(desktopSidebar).toContain("goto(");
	});
});
