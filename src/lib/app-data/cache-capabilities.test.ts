import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type ScopedPermission = {
	identifier: string;
	allow?: { path: string }[];
};

const capability = JSON.parse(
	readFileSync(
		join(process.cwd(), "src-tauri/capabilities/default.json"),
		"utf8",
	),
) as { permissions: (string | ScopedPermission)[] };

function allowedPaths(identifier: string): string[] {
	const permission = capability.permissions.find(
		(value): value is ScopedPermission =>
			typeof value !== "string" && value.identifier === identifier,
	);
	return permission?.allow?.map(({ path }) => path) ?? [];
}

describe("cache filesystem capabilities", () => {
	it("allows every operation used by atomic cache persistence", () => {
		const cacheDataPath = "$APPDATA/cache-*.data";
		const cacheTempPath = "$APPDATA/cache-*.data.tmp";

		for (const identifier of ["fs:allow-exists", "fs:allow-read-file"]) {
			expect(allowedPaths(identifier)).toEqual(
				expect.arrayContaining([cacheDataPath]),
			);
		}
		expect(allowedPaths("fs:allow-write-file")).toEqual(
			expect.arrayContaining([cacheTempPath]),
		);
		expect(allowedPaths("fs:allow-write-file")).not.toContain(cacheDataPath);
		expect(allowedPaths("fs:allow-rename")).toEqual(
			expect.arrayContaining([cacheDataPath, cacheTempPath]),
		);
		expect(allowedPaths("fs:allow-remove")).toEqual(
			expect.arrayContaining([cacheDataPath]),
		);
	});

	it("allows legacy caches to be migrated and removed", () => {
		const legacyCachePaths = [
			"$APPDATA/grid-cache.data",
			"$APPDATA/profile-cache.data",
		];

		for (const identifier of [
			"fs:allow-exists",
			"fs:allow-read-file",
			"fs:allow-remove",
		]) {
			expect(allowedPaths(identifier)).toEqual(
				expect.arrayContaining(legacyCachePaths),
			);
		}
	});
});
