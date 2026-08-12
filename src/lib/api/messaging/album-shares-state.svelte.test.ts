import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAlbumSharesMock } = vi.hoisted(() => ({
	getAlbumSharesMock: vi.fn(),
}));

vi.mock("$lib/api/messaging/albums", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api/messaging/albums")>()),
	getAlbumShares: getAlbumSharesMock,
}));

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import {
	clearAlbumShareState,
	ensureAlbumSharesSwept,
	getAlbumShared,
	setAlbumShared,
} from "$lib/api/messaging/album-shares-state.svelte";
import { resetNowForTesting, setNowForTesting } from "$lib/util/clock";

const ALBUMS = [{ albumId: 1 }, { albumId: 2 }];

beforeEach(() => {
	getAlbumSharesMock.mockReset();
});

afterEach(() => {
	clearAlbumShareState();
	resetNowForTesting();
	vi.restoreAllMocks();
});

describe("album share state", () => {
	it("reports unknown for an album it has never seen", () => {
		expect(getAlbumShared(1, 42)).toBeUndefined();
	});

	it("distinguishes unknown from known-unshared", () => {
		setAlbumShared(1, 42, false);

		expect(getAlbumShared(1, 42)).toBe(false);
		expect(getAlbumShared(2, 42)).toBeUndefined();
	});

	it("keys on the profile as well as the album", () => {
		setAlbumShared(1, 42, true);

		expect(getAlbumShared(1, 42)).toBe(true);
		expect(getAlbumShared(1, 43)).toBeUndefined();
	});
});

describe("ensureAlbumSharesSwept", () => {
	it("records which albums are shared with the profile", async () => {
		getAlbumSharesMock.mockImplementation((albumId: number) =>
			Promise.resolve(albumId === 1 ? [42, 43] : [43]),
		);

		await ensureAlbumSharesSwept(42, ALBUMS);

		expect(getAlbumShared(1, 42)).toBe(true);
		expect(getAlbumShared(2, 42)).toBe(false);
	});

	it("does not sweep again within the TTL, and does after it", async () => {
		let clock = 1_000;
		setNowForTesting(() => clock);
		getAlbumSharesMock.mockResolvedValue([]);

		await ensureAlbumSharesSwept(42, ALBUMS);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);

		await ensureAlbumSharesSwept(42, ALBUMS);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);

		clock += 60_000;
		await ensureAlbumSharesSwept(42, ALBUMS);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(4);
	});

	it("fills a newly requested album even when the profile sweep is fresh", async () => {
		setNowForTesting(() => 1_000);
		getAlbumSharesMock.mockResolvedValue([]);

		await ensureAlbumSharesSwept(42, [{ albumId: 1 }]);
		await ensureAlbumSharesSwept(42, ALBUMS);

		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);
		expect(getAlbumSharesMock).toHaveBeenNthCalledWith(1, 1);
		expect(getAlbumSharesMock).toHaveBeenNthCalledWith(2, 2);
		expect(getAlbumShared(2, 42)).toBe(false);
	});

	it("shares one sweep between concurrent callers", async () => {
		getAlbumSharesMock.mockResolvedValue([]);

		await Promise.all([
			ensureAlbumSharesSwept(42, ALBUMS),
			ensureAlbumSharesSwept(42, ALBUMS),
			ensureAlbumSharesSwept(42, ALBUMS),
		]);

		expect(getAlbumSharesMock).toHaveBeenCalledTimes(ALBUMS.length);
	});

	it("keeps going when one album's lookup fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const lookupError = new Error("nope");
		getAlbumSharesMock.mockImplementation((albumId: number) =>
			albumId === 1 ? Promise.reject(lookupError) : Promise.resolve([42]),
		);

		await ensureAlbumSharesSwept(42, ALBUMS);

		expect(getAlbumShared(1, 42)).toBeUndefined();
		expect(getAlbumShared(2, 42)).toBe(true);

		getAlbumSharesMock.mockResolvedValue([]);
		await ensureAlbumSharesSwept(42, ALBUMS);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(4);
		expect(getAlbumShared(1, 42)).toBe(false);
		expect(consoleError).toHaveBeenCalledWith(lookupError);
	});

	it("retries after a wholesale failure instead of caching it as checked", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const offlineError = new Error("offline");
		setNowForTesting(() => 1_000);
		getAlbumSharesMock.mockRejectedValue(offlineError);

		await ensureAlbumSharesSwept(42, ALBUMS);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);

		// Still within the TTL, but nothing landed, so it must try again.
		getAlbumSharesMock.mockResolvedValue([42]);
		await ensureAlbumSharesSwept(42, ALBUMS);

		expect(getAlbumSharesMock).toHaveBeenCalledTimes(4);
		expect(getAlbumShared(1, 42)).toBe(true);
		expect(consoleError).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalledWith(offlineError);
	});

	it("tracks profiles separately", async () => {
		setNowForTesting(() => 1_000);
		getAlbumSharesMock.mockResolvedValue([]);

		await ensureAlbumSharesSwept(42, ALBUMS);
		await ensureAlbumSharesSwept(43, ALBUMS);

		expect(getAlbumSharesMock).toHaveBeenCalledTimes(4);
	});

	it("bounds lookup concurrency and discards completion after account switch", async () => {
		activateAccountSession(100);
		let active = 0;
		let peak = 0;
		const releases: Array<() => void> = [];
		getAlbumSharesMock.mockImplementation(
			() =>
				new Promise<number[]>((resolve) => {
					active += 1;
					peak = Math.max(peak, active);
					releases.push(() => {
						active -= 1;
						resolve([42]);
					});
				}),
		);
		const pending = ensureAlbumSharesSwept(
			42,
			Array.from({ length: 12 }, (_, index) => ({ albumId: index + 1 })),
		);
		await vi.waitFor(() => expect(releases).toHaveLength(3));
		invalidateAccountSession();
		while (releases.length > 0) releases.shift()?.();
		await pending;
		expect(peak).toBe(3);
		expect(getAlbumShared(1, 42)).toBeUndefined();
	});

	it("an obsolete sweep cannot delete a newer same-recipient registration", async () => {
		activateAccountSession(200);
		const releases: Array<() => void> = [];
		getAlbumSharesMock.mockImplementation(
			() =>
				new Promise<number[]>((resolve) => {
					releases.push(() => resolve([]));
				}),
		);
		const obsolete = ensureAlbumSharesSwept(42, [{ albumId: 1 }]);
		await vi.waitFor(() => expect(releases).toHaveLength(1));
		invalidateAccountSession();
		activateAccountSession(201);
		const current = ensureAlbumSharesSwept(42, [{ albumId: 2 }]);
		await vi.waitFor(() => expect(releases).toHaveLength(2));
		releases[0]!();
		await obsolete;
		const overlapping = ensureAlbumSharesSwept(42, [{ albumId: 2 }]);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);
		releases[1]!();
		await Promise.all([current, overlapping]);
		expect(getAlbumSharesMock).toHaveBeenCalledTimes(2);
	});
});
