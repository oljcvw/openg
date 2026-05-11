import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, root), "utf8");
}

describe("Android release target", () => {
	it("exposes repeatable Android package scripts", () => {
		const packageJson = JSON.parse(read("package.json")) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts["android:init"]).toBe(
			"tauri android init --ci --skip-targets-install",
		);
		expect(packageJson.scripts["dev:android"]).toBe("tauri android dev");
		expect(packageJson.scripts["build:android"]).toBe(
			"tauri android build --ci --aab --apk --target aarch64",
		);
		expect(packageJson.scripts["build:android:debug"]).toBe(
			"tauri android build --debug --apk --target aarch64",
		);
	});

	it("keeps Android release identity and webview policy explicit", () => {
		const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
			identifier: string;
			app: { security: { csp: string } };
			build: { beforeBuildCommand: string; frontendDist: string };
		};

		expect(tauriConfig.identifier).toBe("org.opengrind");
		expect(tauriConfig.build.beforeBuildCommand).toBe("bun run build");
		expect(tauriConfig.build.frontendDist).toBe("../build");
		expect(tauriConfig.app.security.csp).toContain("https://*.grindr.com");
		expect(tauriConfig.app.security.csp).toContain("wss://*.grindr.com");
		expect(tauriConfig.app.security.csp).not.toContain("http:");
	});

	it("commits the generated Android project with release hardening", () => {
		expect(
			existsSync(new URL("src-tauri/gen/android/gradlew", root)),
		).toBe(true);
		expect(
			existsSync(
				new URL(
					"src-tauri/gen/android/app/src/main/java/org/opengrind/MainActivity.kt",
					root,
				),
			),
		).toBe(true);

		const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
		expect(gradle).toContain('namespace = "org.opengrind"');
		expect(gradle).toContain('applicationId = "org.opengrind"');
		expect(gradle).toContain("minSdk = 24");
		expect(gradle).toContain("targetSdk = 36");
		expect(gradle).toContain('getByName("release")');
		expect(gradle).toContain("isMinifyEnabled = true");
		expect(gradle).toContain("proguard-android-optimize.txt");
	});

	it("limits Android builds to supported 64-bit release ABIs", () => {
		const packageJson = JSON.parse(read("package.json")) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts["build:android"]).toContain("--target aarch64");
		expect(packageJson.scripts["build:android:debug"]).toContain(
			"--target aarch64",
		);
		expect(packageJson.scripts["build:android"]).not.toContain("armv7");
		expect(packageJson.scripts["build:android"]).not.toContain("i686");
	});

	it("declares Android runtime permissions used by shared mobile features", () => {
		const manifest = read(
			"src-tauri/gen/android/app/src/main/AndroidManifest.xml",
		);

		expect(manifest).toContain("android.permission.INTERNET");
		expect(manifest).toContain("android.permission.ACCESS_COARSE_LOCATION");
		expect(manifest).toContain("android.permission.ACCESS_FINE_LOCATION");
		expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
		expect(manifest).toContain('android:usesCleartextTraffic="${usesCleartextTraffic}"');
	});

	it("documents Android setup, validation, and release commands", () => {
		const androidGuide = read("docs/content/guide/android.md");

		expect(androidGuide).toContain("# Android");
		expect(androidGuide).toContain("bun run android:init");
		expect(androidGuide).toContain("bun run dev:android");
		expect(androidGuide).toContain("bun run build:android");
		expect(androidGuide).toContain("ANDROID_HOME");
		expect(androidGuide).toContain("NDK");
		expect(androidGuide).toContain("JDK 17");
		expect(androidGuide).toContain("aarch64");
		expect(androidGuide).toContain("signing");
	});
});
