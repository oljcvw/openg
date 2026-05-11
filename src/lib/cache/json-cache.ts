import {
	BaseDirectory,
	exists,
	mkdir,
	readTextFile,
	remove,
	writeTextFile,
} from "@tauri-apps/plugin-fs";
import z from "zod";

type CacheEntry<T> = {
	version: 1;
	storedAt: number;
	expiresAt: number | null;
	value: T;
};

type AppCacheFs = {
	exists: typeof exists;
	mkdir: typeof mkdir;
	readTextFile: typeof readTextFile;
	remove: typeof remove;
	writeTextFile: typeof writeTextFile;
};

type JsonCacheOptions<TSchema extends z.ZodType> = {
	namespace: string;
	schema: TSchema;
	ttlMs?: number;
	now?: () => number;
	fs?: AppCacheFs;
	rootPath?: string;
};

const defaultFs: AppCacheFs = {
	exists,
	mkdir,
	readTextFile,
	remove,
	writeTextFile,
};

const CACHE_ROOT = "json-cache";
const CACHE_BASE_DIR = BaseDirectory.AppCache;

function pathSegment(value: string) {
	const bytes = new TextEncoder().encode(value);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function makeCacheDir(rootPath: string, namespace: string) {
	return `${rootPath}/n-${pathSegment(namespace)}`;
}

function makeCachePath(rootPath: string, namespace: string, key: string) {
	return `${makeCacheDir(rootPath, namespace)}/k-${pathSegment(key)}.json`;
}

function entrySchema<TSchema extends z.ZodType>(schema: TSchema) {
	return z.object({
		version: z.literal(1),
		storedAt: z.number().int().nonnegative(),
		expiresAt: z.number().int().nonnegative().nullable(),
		value: schema,
	});
}

export function createJsonCache<TSchema extends z.ZodType>({
	namespace,
	schema,
	ttlMs,
	now = () => Date.now(),
	fs = defaultFs,
	rootPath = CACHE_ROOT,
}: JsonCacheOptions<TSchema>) {
	type Value = z.infer<TSchema>;
	const hotEntries = new Map<string, CacheEntry<Value>>();
	const schemaForEntry = entrySchema(schema);
	const cacheDir = makeCacheDir(rootPath, namespace);

	function isExpired(entry: CacheEntry<Value>) {
		return entry.expiresAt !== null && entry.expiresAt <= now();
	}

	async function readEntry(storageKey: string) {
		if (!(await fs.exists(storageKey, { baseDir: CACHE_BASE_DIR }))) {
			return null;
		}
		return fs.readTextFile(storageKey, { baseDir: CACHE_BASE_DIR });
	}

	async function removeStorageKey(storageKey: string) {
		hotEntries.delete(storageKey);
		if (await fs.exists(storageKey, { baseDir: CACHE_BASE_DIR })) {
			await fs.remove(storageKey, { baseDir: CACHE_BASE_DIR });
		}
	}

	return {
		async get(key: string): Promise<Value | undefined> {
			const storageKey = makeCachePath(rootPath, namespace, key);
			const hotEntry = hotEntries.get(storageKey);
			if (hotEntry) {
				if (!isExpired(hotEntry)) return hotEntry.value;
				await removeStorageKey(storageKey);
				return undefined;
			}

			const raw = await readEntry(storageKey);
			if (raw === null) return undefined;

			let parsed: CacheEntry<Value>;
			try {
				parsed = schemaForEntry.parse(JSON.parse(raw)) as CacheEntry<Value>;
			} catch (error) {
				console.warn("Dropping invalid cache entry", {
					namespace,
					key,
					error,
				});
				await removeStorageKey(storageKey);
				return undefined;
			}

			if (isExpired(parsed)) {
				await removeStorageKey(storageKey);
				return undefined;
			}

			hotEntries.set(storageKey, parsed);
			return parsed.value;
		},

		async set(key: string, value: Value): Promise<void> {
			const storageKey = makeCachePath(rootPath, namespace, key);
			const parsedValue = schema.parse(value) as Value;
			const storedAt = now();
			const entry: CacheEntry<Value> = {
				version: 1,
				storedAt,
				expiresAt: ttlMs === undefined ? null : storedAt + ttlMs,
				value: parsedValue,
			};
			hotEntries.set(storageKey, entry);

			try {
				await fs.mkdir(cacheDir, {
					baseDir: CACHE_BASE_DIR,
					recursive: true,
				});
				await fs.writeTextFile(storageKey, JSON.stringify(entry), {
					baseDir: CACHE_BASE_DIR,
				});
			} catch (error) {
				console.warn("Failed to persist cache entry", {
					namespace,
					key,
					error,
				});
			}
		},

		async delete(key: string): Promise<void> {
			await removeStorageKey(makeCachePath(rootPath, namespace, key));
		},

		async clear(): Promise<void> {
			hotEntries.clear();
			if (await fs.exists(cacheDir, { baseDir: CACHE_BASE_DIR })) {
				await fs.remove(cacheDir, {
					baseDir: CACHE_BASE_DIR,
					recursive: true,
				});
			}
		},
	};
}
