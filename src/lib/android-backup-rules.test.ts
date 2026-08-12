import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const resources = join(
	process.cwd(),
	"src-tauri/gen/android/app/src/main/res/xml",
);
const sensitivePaths = [
	"album-cache-v1/",
	"direct-media-cache-v1/",
	"short-video-cache/",
	"saved-phrases.data",
	"saved-phrases.data.tmp",
];

describe("Android private-data backup rules", () => {
	it.each(["backup_rules.xml", "data_extraction_rules.xml"])(
		"excludes every sensitive media and text path in %s",
		(file) => {
			const rules = readFileSync(join(resources, file), "utf8");
			for (const path of sensitivePaths)
				expect(rules).toContain(`domain="file" path="${path}"`);
		},
	);
});
