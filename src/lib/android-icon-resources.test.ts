import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const outputDirectory = mkdtempSync(join(tmpdir(), "open-grind-icons-"));
const foreground = join(outputDirectory, "ic_launcher_foreground.xml");

afterAll(() => rmSync(outputDirectory, { force: true, recursive: true }));

describe("Android launcher resources", () => {
	it("generates one API-independent adaptive-icon foreground", () => {
		const result = spawnSync(
			"bun",
			[
				"scripts/svg-to-android-vector.ts",
				"contrib/logo/app-foreground-icon.svg",
				foreground,
				"--width",
				"108",
				"--height",
				"108",
				"--scale",
				"0.832",
			],
			{ cwd: process.cwd(), encoding: "utf8" },
		);

		expect(result.status, result.stderr).toBe(0);
		expect(readFileSync(foreground, "utf8")).toContain(
			'<vector xmlns:android="http://schemas.android.com/apk/res/android"',
		);
	});
});
