import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, root), "utf8");
}

function scriptTokens(name: string): string[] {
	const packageJson = JSON.parse(read("package.json")) as {
		scripts: Record<string, string>;
	};

	return packageJson.scripts[name]?.split(/\s+/) ?? [];
}

describe("macOS release target", () => {
	it("exposes repeatable macOS package scripts", () => {
		expect(scriptTokens("dev:macos")).toEqual(["tauri", "dev"]);
		expect(scriptTokens("build:macos")).toEqual(["bun", "run", "build:macos:unsigned"]);

		const unsignedBuild = scriptTokens("build:macos:unsigned");
		expect(unsignedBuild).toEqual(
			expect.arrayContaining([
				"tauri",
				"build",
				"--ci",
				"--bundles",
				"app,dmg",
				"--target",
				"universal-apple-darwin",
				"--no-sign",
			]),
		);

		const signedBuild = scriptTokens("build:macos:signed");
		expect(signedBuild).toEqual(
			expect.arrayContaining([
				"tauri",
				"build",
				"--ci",
				"--bundles",
				"app,dmg",
				"--target",
				"universal-apple-darwin",
			]),
		);
		expect(signedBuild).not.toContain("--no-sign");

		expect(scriptTokens("build:macos:debug")).toEqual(
			expect.arrayContaining(["tauri", "build", "--debug", "--bundles", "app", "--no-sign"]),
		);
	});

	it("keeps macOS release packaging explicit and notarization-safe", () => {
		const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
			identifier: string;
			bundle: {
				active: boolean;
				icon: string[];
				macOS: {
					signingIdentity: string | null;
					hardenedRuntime: boolean;
					entitlements: string;
					infoPlist: string;
					minimumSystemVersion: string;
				};
			};
		};

		expect(tauriConfig.identifier).toBe("org.opengrind");
		expect(tauriConfig.bundle.active).toBe(true);
		expect(tauriConfig.bundle.icon).toContain("icons/icon.icns");
		expect(tauriConfig.bundle.macOS.signingIdentity).toBeNull();
		expect(tauriConfig.bundle.macOS.hardenedRuntime).toBe(true);
		expect(tauriConfig.bundle.macOS.entitlements).toBe("Entitlements.plist");
		expect(tauriConfig.bundle.macOS.infoPlist).toBe("Info.plist");
		expect(tauriConfig.bundle.macOS.minimumSystemVersion).toBe("12.0");
	});

	it("defines minimal macOS entitlements without sandbox-only permissions", () => {
		const entitlements = read("src-tauri/Entitlements.plist");

		expect(entitlements).toContain("<dict>");
		expect(entitlements).not.toContain("com.apple.security.app-sandbox");
		expect(entitlements).not.toContain("com.apple.security.network.client");
		expect(entitlements).not.toContain("com.apple.security.files");
	});

	it("adds macOS Info.plist release metadata without unsupported privacy prompts", () => {
		const infoPlist = read("src-tauri/Info.plist");

		expect(infoPlist).toContain("LSApplicationCategoryType");
		expect(infoPlist).toContain("public.app-category.social-networking");
		expect(infoPlist).toContain("NSHumanReadableCopyright");
		expect(infoPlist).not.toContain("NSLocationWhenInUseUsageDescription");
	});

	it("documents macOS setup, signing, notarization, and inspection", () => {
		const macosGuide = read("docs/content/guide/macos.md");

		expect(macosGuide).toContain("# macOS");
		expect(macosGuide).toContain("bun run dev:macos");
		expect(macosGuide).toContain("bun run build:macos");
		expect(macosGuide).toContain("bun run build:macos:signed");
		expect(macosGuide).toContain("universal-apple-darwin");
		expect(macosGuide).toContain("x86_64-apple-darwin");
		expect(macosGuide).toContain("Developer ID Application");
		expect(macosGuide).toContain("APPLE_SIGNING_IDENTITY");
		expect(macosGuide).toContain("APPLE_ID");
		expect(macosGuide).toContain("APPLE_API_KEY");
		expect(macosGuide).toContain("codesign");
		expect(macosGuide).toContain("spctl");
		expect(macosGuide).toContain("stapler");
	});

	it("keeps macOS guide reachable from the docs sidebar", () => {
		const vitepressConfig = read("docs/.vitepress/config.ts");

		expect(vitepressConfig).toContain('{ text: "macOS", link: "/guide/macos" }');
		expect(existsSync(new URL("docs/content/guide/macos.md", root))).toBe(true);
	});
});
