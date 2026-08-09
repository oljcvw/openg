import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const resources = join(process.cwd(), "src-tauri/gen/android/app/src/main/res");

describe("Android launcher resources", () => {
	it("has one canonical adaptive-icon foreground at every API level", () => {
		const adaptiveIcon = readFileSync(
			join(resources, "mipmap-anydpi-v26/ic_launcher.xml"),
			"utf8",
		);

		expect(adaptiveIcon).toContain(
			'android:drawable="@drawable/ic_launcher_foreground"',
		);
		expect(
			existsSync(join(resources, "drawable/ic_launcher_foreground.xml")),
		).toBe(true);
		expect(
			existsSync(join(resources, "drawable-v24/ic_launcher_foreground.xml")),
		).toBe(false);
	});
});
