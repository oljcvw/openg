import z from "zod";

type MaybePromise<T> = T | Promise<T>;

export interface CacheStorageAdapter {
	getItem(key: string): MaybePromise<string | null>;
	setItem(key: string, value: string): MaybePromise<void>;
	removeItem(key: string): MaybePromise<void>;
	keys(): MaybePromise<Iterable<string>>;
}

export class MemoryCacheStorage implements CacheStorageAdapter {
	#items = new Map<string, string>();
	#failNextWrite = false;

	async getItem(key: string) {
		return this.#items.get(key) ?? null;
	}

	async setItem(key: string, value: string) {
		if (this.#failNextWrite) {
			this.#failNextWrite = false;
			throw new DOMException("Quota exceeded", "QuotaExceededError");
		}
		this.#items.set(key, value);
	}

	async removeItem(key: string) {
		this.#items.delete(key);
	}

	async keys() {
		return this.#items.keys();
	}

	failNextWrite() {
		this.#failNextWrite = true;
	}
}

type CacheEntry<T> = {
	version: 1;
	storedAt: number;
	expiresAt: number | null;
	value: T;
};

type JsonCacheOptions<TSchema extends z.ZodType> = {
	namespace: string;
	schema: TSchema;
	storage: CacheStorageAdapter;
	ttlMs?: number;
	now?: () => number;
};

const CACHE_KEY_PREFIX = "open-grind-cache";

function makeCacheKey(namespace: string, key: string) {
	return `${CACHE_KEY_PREFIX}:${namespace}:${key}`;
}

function makeCachePrefix(namespace: string) {
	return `${CACHE_KEY_PREFIX}:${namespace}:`;
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
	storage,
	ttlMs,
	now = () => Date.now(),
}: JsonCacheOptions<TSchema>) {
	type Value = z.infer<TSchema>;
	const hotEntries = new Map<string, CacheEntry<Value>>();
	const schemaForEntry = entrySchema(schema);

	function isExpired(entry: CacheEntry<Value>) {
		return entry.expiresAt !== null && entry.expiresAt <= now();
	}

	async function removeStorageKey(storageKey: string) {
		hotEntries.delete(storageKey);
		await storage.removeItem(storageKey);
	}

	return {
		async get(key: string): Promise<Value | undefined> {
			const storageKey = makeCacheKey(namespace, key);
			const hotEntry = hotEntries.get(storageKey);
			if (hotEntry) {
				if (!isExpired(hotEntry)) return hotEntry.value;
				await removeStorageKey(storageKey);
				return undefined;
			}

			const raw = await storage.getItem(storageKey);
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
			const storageKey = makeCacheKey(namespace, key);
			const parsedValue = schema.parse(value) as Value;
			const entry: CacheEntry<Value> = {
				version: 1,
				storedAt: now(),
				expiresAt: ttlMs === undefined ? null : now() + ttlMs,
				value: parsedValue,
			};
			hotEntries.set(storageKey, entry);

			try {
				await storage.setItem(storageKey, JSON.stringify(entry));
			} catch (error) {
				console.warn("Failed to persist cache entry", {
					namespace,
					key,
					error,
				});
			}
		},

		async delete(key: string): Promise<void> {
			await removeStorageKey(makeCacheKey(namespace, key));
		},

		async clear(): Promise<void> {
			const prefix = makeCachePrefix(namespace);
			for (const key of await storage.keys()) {
				if (key.startsWith(prefix)) await removeStorageKey(key);
			}
			for (const key of hotEntries.keys()) {
				if (key.startsWith(prefix)) hotEntries.delete(key);
			}
		},
	};
}

function defaultLocalStorage() {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
}

export function createLocalStorageCacheStorage(
	storage: Storage | undefined = defaultLocalStorage(),
): CacheStorageAdapter {
	if (!storage) return new MemoryCacheStorage();

	return {
		getItem(key: string) {
			return storage.getItem(key);
		},
		setItem(key: string, value: string) {
			storage.setItem(key, value);
		},
		removeItem(key: string) {
			storage.removeItem(key);
		},
		keys() {
			const keys: string[] = [];
			for (let index = 0; index < storage.length; index += 1) {
				const key = storage.key(index);
				if (key !== null) keys.push(key);
			}
			return keys;
		},
	};
}
