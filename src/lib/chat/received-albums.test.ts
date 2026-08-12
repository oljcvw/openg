import { describe, expect, it, vi } from "vitest";

import {
	isSafeToHydrateReceivedAlbum,
	ReceivedAlbumHydrator,
} from "$lib/chat/received-albums";
import type { ReceivedAlbumBrief } from "$lib/model/messaging/albums";

function album(
	overrides: Partial<ReceivedAlbumBrief> = {},
): ReceivedAlbumBrief {
	return {
		albumId: 1,
		albumName: null,
		albumViewable: true,
		hasUnseenContent: false,
		profileId: 42,
		expiresAt: null,
		expirationType: "INDEFINITE",
		...overrides,
	};
}

describe("received album hydration", () => {
	it("background-hydrates only unambiguous, viewable, non-expiring albums", () => {
		expect(isSafeToHydrateReceivedAlbum(album())).toBe(true);
		expect(isSafeToHydrateReceivedAlbum(album({ albumViewable: false }))).toBe(
			false,
		);
		expect(
			isSafeToHydrateReceivedAlbum(album({ expirationType: "ONCE" })),
		).toBe(false);
		expect(isSafeToHydrateReceivedAlbum(album({ expirationType: null }))).toBe(
			false,
		);
		expect(
			isSafeToHydrateReceivedAlbum(album({ expiresAt: Date.now() + 10_000 })),
		).toBe(false);
	});

	it("limits work to two requests and cancels obsolete queued or active rows", async () => {
		const releases: Array<() => void> = [];
		const started: number[] = [];
		const load = vi.fn((albumId: number, signal: AbortSignal) => {
			started.push(albumId);
			return new Promise<number>((resolve, reject) => {
				const abort = () => reject(new DOMException("Aborted", "AbortError"));
				signal.addEventListener("abort", abort, { once: true });
				releases.push(() => {
					signal.removeEventListener("abort", abort);
					resolve(albumId);
				});
			});
		});
		const hydrator = new ReceivedAlbumHydrator(load, 2);

		const first = hydrator.request(1);
		const second = hydrator.request(2);
		const third = hydrator.request(3);
		await Promise.resolve();
		expect(started).toEqual([1, 2]);

		hydrator.cancel(1);
		await expect(first).resolves.toBeNull();
		await Promise.resolve();
		expect(started).toEqual([1, 2, 3]);
		hydrator.cancel(3);
		await expect(third).resolves.toBeNull();
		releases[1]?.();
		await expect(second).resolves.toBe(2);
	});
});
