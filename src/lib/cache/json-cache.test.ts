import { describe, expect, it, vi } from "vitest";
import z from "zod";
import {
	createJsonCache,
	createLocalStorageCacheStorage,
	MemoryCacheStorage,
} from "$lib/cache/json-cache";

const profileSchema = z.object({
	id: z.number().int().nonnegative(),
	name: z.string(),
});

describe("createJsonCache", () => {
	it("returns undefined when an entry is missing", async () => {
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			storage: new MemoryCacheStorage(),
		});

		await expect(cache.get("1")).resolves.toBeUndefined();
	});

	it("returns cached values until their ttl expires", async () => {
		let now = 1_000;
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			storage: new MemoryCacheStorage(),
			ttlMs: 100,
			now: () => now,
		});

		await cache.set("1", { id: 1, name: "Ada" });

		await expect(cache.get("1")).resolves.toEqual({ id: 1, name: "Ada" });

		now = 1_101;

		await expect(cache.get("1")).resolves.toBeUndefined();
	});

	it("deletes malformed or schema-incompatible entries", async () => {
		const storage = new MemoryCacheStorage();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			storage,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await storage.setItem("open-grind-cache:profiles:1", "{bad json");
		await storage.setItem(
			"open-grind-cache:profiles:2",
			JSON.stringify({
				version: 1,
				storedAt: 1,
				expiresAt: null,
				value: { id: -1, name: "Ada" },
			}),
		);

		await expect(cache.get("1")).resolves.toBeUndefined();
		await expect(cache.get("2")).resolves.toBeUndefined();
		await expect(
			storage.getItem("open-grind-cache:profiles:1"),
		).resolves.toBeNull();
		await expect(
			storage.getItem("open-grind-cache:profiles:2"),
		).resolves.toBeNull();
		expect(warn).toHaveBeenCalledTimes(2);

		warn.mockRestore();
	});

	it("clears only matching namespace keys", async () => {
		const storage = new MemoryCacheStorage();
		const cache = createJsonCache({
			namespace: "user",
			schema: profileSchema,
			storage,
		});

		await cache.set("1", { id: 1, name: "Ada" });
		await storage.setItem("open-grind-cache:user-pref:1", "keep");

		await cache.clear();

		await expect(
			storage.getItem("open-grind-cache:user:1"),
		).resolves.toBeNull();
		await expect(storage.getItem("open-grind-cache:user-pref:1")).resolves.toBe(
			"keep",
		);
	});

	it("keeps hot reads in memory when storage writes fail", async () => {
		const storage = new MemoryCacheStorage();
		storage.failNextWrite();
		const cache = createJsonCache({
			namespace: "profiles",
			schema: profileSchema,
			storage,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cache.set("1", { id: 1, name: "Ada" });

		await expect(cache.get("1")).resolves.toEqual({ id: 1, name: "Ada" });
		await expect(
			storage.getItem("open-grind-cache:profiles:1"),
		).resolves.toBeNull();
		expect(warn).toHaveBeenCalledOnce();

		warn.mockRestore();
	});
});

describe("createLocalStorageCacheStorage", () => {
	it("falls back to in-memory storage when browser storage is unavailable", async () => {
		const storage = createLocalStorageCacheStorage(undefined);

		await storage.setItem("key", "value");

		await expect(storage.getItem("key")).resolves.toBe("value");
	});
});
