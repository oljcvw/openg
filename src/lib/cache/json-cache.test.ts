import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { describe, expect, it, vi } from "vitest";
import z from "zod";
import { createJsonCache } from "$lib/cache/json-cache";

const profileSchema = z.object({
	id: z.number().int().nonnegative(),
	name: z.string(),
});

function pathSegment(value: string) {
	const bytes = new TextEncoder().encode(value);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function cacheDir(namespace: string) {
	return `json-cache/n-${pathSegment(namespace)}`;
}

function cachePath(namespace: string, key: string) {
	return `${cacheDir(namespace)}/k-${pathSegment(key)}.json`;
}

function createMockFs() {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	const calls: { method: string; path: string; baseDir: unknown }[] = [];
	let failNextWrite = false;

	function record(
		method: string,
		path: string | URL,
		options?: { baseDir?: unknown },
	) {
		calls.push({ method, path: String(path), baseDir: options?.baseDir });
	}

	return {
		calls,
		dirs,
		files,
		failNextWrite() {
			failNextWrite = true;
		},
		fs: {
			async exists(path: string | URL, options?: { baseDir?: unknown }) {
				record("exists", path, options);
				const value = String(path);
				return (
					files.has(value) ||
					dirs.has(value) ||
					Array.from(files.keys()).some((key) => key.startsWith(`${value}/`))
				);
			},
			async mkdir(path: string | URL, options?: { baseDir?: unknown }) {
				record("mkdir", path, options);
				dirs.add(String(path));
			},
			async readTextFile(path: string | URL, options?: { baseDir?: unknown }) {
				record("readTextFile", path, options);
				const value = files.get(String(path));
				if (value === undefined) throw new Error(`Missing file: ${String(path)}`);
				return value;
			},
			async remove(
				path: string | URL,
				options?: { baseDir?: unknown; recursive?: boolean },
			) {
				record("remove", path, options);
				const value = String(path);
				if (options?.recursive) {
					for (const key of Array.from(files.keys())) {
						if (key.startsWith(`${value}/`)) files.delete(key);
					}
				} else {
					files.delete(value);
				}
				dirs.delete(value);
			},
			async writeTextFile(
				path: string | URL,
				data: string,
				options?: { baseDir?: unknown },
			) {
				record("writeTextFile", path, options);
				if (failNextWrite) {
					failNextWrite = false;
					throw new Error("write failed");
				}
				files.set(String(path), data);
			},
		},
	};
}

describe("createJsonCache", () => {
	it("returns undefined when an entry is missing", async () => {
		const { fs } = createMockFs();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			fs,
		});

		await expect(cache.get("1")).resolves.toBeUndefined();
	});

	it("persists values in the Tauri AppCache directory", async () => {
		const mock = createMockFs();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			fs: mock.fs,
		});

		await cache.set("1", { id: 1, name: "Ada" });

		expect(mock.files.has(cachePath("profiles", "1"))).toBe(true);
		expect(mock.calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					method: "mkdir",
					path: cacheDir("profiles"),
					baseDir: BaseDirectory.AppCache,
				}),
				expect.objectContaining({
					method: "writeTextFile",
					path: cachePath("profiles", "1"),
					baseDir: BaseDirectory.AppCache,
				}),
			]),
		);
	});

	it("returns cached values until their ttl expires", async () => {
		let now = 1_000;
		const { fs } = createMockFs();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			fs,
			ttlMs: 100,
			now: () => now,
		});

		await cache.set("1", { id: 1, name: "Ada" });

		await expect(cache.get("1")).resolves.toEqual({ id: 1, name: "Ada" });

		now = 1_101;

		await expect(cache.get("1")).resolves.toBeUndefined();
	});

	it("deletes malformed or schema-incompatible entries", async () => {
		const mock = createMockFs();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			fs: mock.fs,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mock.dirs.add(cacheDir("profiles"));
		mock.files.set(cachePath("profiles", "1"), "{bad json");
		mock.files.set(
			cachePath("profiles", "2"),
			JSON.stringify({
				version: 1,
				storedAt: 1,
				expiresAt: null,
				value: { id: -1, name: "Ada" },
			}),
		);

		await expect(cache.get("1")).resolves.toBeUndefined();
		await expect(cache.get("2")).resolves.toBeUndefined();
		expect(mock.files.has(cachePath("profiles", "1"))).toBe(false);
		expect(mock.files.has(cachePath("profiles", "2"))).toBe(false);
		expect(warn).toHaveBeenCalledTimes(2);

		warn.mockRestore();
	});

	it("clears only the current namespace", async () => {
		const mock = createMockFs();
		const cache = createJsonCache({
			namespace: "user",
			schema: profileSchema,
			fs: mock.fs,
		});

		await cache.set("1", { id: 1, name: "Ada" });
		mock.dirs.add(cacheDir("user-pref"));
		mock.files.set(cachePath("user-pref", "1"), "keep");

		await cache.clear();

		expect(mock.files.has(cachePath("user", "1"))).toBe(false);
		expect(mock.files.get(cachePath("user-pref", "1"))).toBe("keep");
	});

	it("keeps hot reads in memory when AppCache writes fail", async () => {
		const mock = createMockFs();
		mock.failNextWrite();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			fs: mock.fs,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cache.set("1", { id: 1, name: "Ada" });

		await expect(cache.get("1")).resolves.toEqual({ id: 1, name: "Ada" });
		expect(mock.files.has(cachePath("profiles", "1"))).toBe(false);
		expect(warn).toHaveBeenCalledOnce();

		warn.mockRestore();
	});
});
