import { describe, expect, it, vi } from "vitest";

import type { SharedMediaEntry } from "$lib/chat/shared-media";
import {
	resolveBoundedLegacyRemoteVideo,
	resolveLegacyShortVideo,
} from "./legacy-video-source";

const entry = (
	overrides: Partial<SharedMediaEntry> = {},
): SharedMediaEntry => ({
	accountProfileId: 10,
	conversationId: "10:20",
	peerProfileId: 20,
	messageId: "message-1",
	mediaId: "30",
	kind: "video",
	messageType: "PrivateVideo",
	sentAt: 1_000,
	remoteAvailability: "available",
	cacheAvailability: "not_cached",
	cacheToken: null,
	consumptive: true,
	remoteUrl: "https://cdns.grindr.com/video.mp4",
	...overrides,
});

function dependencies() {
	const session = { accountId: 10, generation: 1 };
	return {
		lookup: vi.fn().mockResolvedValue({ found: false }),
		readLegacy: vi.fn().mockResolvedValue({
			found: true,
			contentType: "video/mp4",
			dataBase64: "bGVnYWN5",
			byteLength: 6,
		}),
		promote: vi.fn().mockResolvedValue("direct-media-cache://localhost/opaque"),
		removeLegacy: vi.fn().mockResolvedValue(true),
		getSession: vi.fn(() => session),
		isSessionCurrent: vi.fn(() => true),
	};
}

describe("legacy short-video promotion", () => {
	it("returns the direct-media URL after identity-bound promotion succeeds", async () => {
		const deps = dependencies();

		await expect(resolveLegacyShortVideo(entry(), 30, deps)).resolves.toBe(
			"direct-media-cache://localhost/opaque",
		);
		expect(deps.readLegacy).toHaveBeenCalledWith(30, 10);
		expect(deps.promote).toHaveBeenCalledWith(
			entry(),
			"video/mp4",
			"bGVnYWN5",
			6,
		);
		expect(deps.removeLegacy).toHaveBeenCalledWith(30, 10);
	});

	it("preserves the legacy fallback when promotion fails", async () => {
		const deps = dependencies();
		deps.promote.mockRejectedValue(new Error("cache unavailable"));

		await expect(resolveLegacyShortVideo(entry(), 30, deps)).resolves.toBe(
			"data:video/mp4;base64,bGVnYWN5",
		);
		expect(deps.removeLegacy).not.toHaveBeenCalled();
	});

	it("promotes legacy bytes without requiring a remote URL", async () => {
		const deps = dependencies();

		await expect(
			resolveLegacyShortVideo(entry({ remoteUrl: null }), 30, deps),
		).resolves.toBe("direct-media-cache://localhost/opaque");
		expect(deps.promote).toHaveBeenCalledOnce();
		expect(deps.removeLegacy).toHaveBeenCalledWith(30, 10);
	});

	it("never reads the legacy cache for a mismatched media identity", async () => {
		const deps = dependencies();

		await expect(
			resolveLegacyShortVideo(entry(), 31, deps),
		).resolves.toBeNull();
		expect(deps.lookup).not.toHaveBeenCalled();
		expect(deps.readLegacy).not.toHaveBeenCalled();
		expect(deps.promote).not.toHaveBeenCalled();
		expect(deps.removeLegacy).not.toHaveBeenCalled();
	});

	it("uses an existing verified direct-media record when no beta4 source remains", async () => {
		const deps = dependencies();
		deps.readLegacy.mockResolvedValue({ found: false });
		deps.lookup.mockResolvedValue({
			found: true,
			protocolUrl: "direct-media-cache://localhost/already-promoted",
		});

		await expect(resolveLegacyShortVideo(entry(), 30, deps)).resolves.toBe(
			"direct-media-cache://localhost/already-promoted",
		);
		expect(deps.readLegacy).toHaveBeenCalledWith(30, 10);
		expect(deps.promote).not.toHaveBeenCalled();
		expect(deps.removeLegacy).not.toHaveBeenCalled();
	});

	it("does not read, delete, or return account A media after switching to account B", async () => {
		const deps = dependencies();
		deps.isSessionCurrent.mockReturnValue(false);

		await expect(
			resolveLegacyShortVideo(entry(), 30, deps),
		).resolves.toBeNull();
		expect(deps.readLegacy).toHaveBeenCalledWith(30, 10);
		expect(deps.promote).not.toHaveBeenCalled();
		expect(deps.removeLegacy).not.toHaveBeenCalled();
	});
});

describe("bounded legacy remote-video caching", () => {
	const settings = () => ({
		legacyShortVideoFetchMaxMb: 30,
		legacyShortVideoFetchTimeoutMs: 30_000,
	});
	const sessionDependencies = {
		getSession: () => ({ accountId: 10, generation: 1 }),
		isSessionCurrent: () => true,
	};

	it("streams a validated video into the legacy cache", async () => {
		const cache = vi.fn().mockResolvedValue(undefined);
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: {
					"content-type": "video/mp4",
					"content-length": "3",
				},
			}),
		);

		await expect(
			resolveBoundedLegacyRemoteVideo("https://cdns.grindr.com/video", 30, {
				fetch: fetchMock,
				cache,
				settings,
				...sessionDependencies,
			}),
		).resolves.toBe("data:video/mp4;base64,AQID");
		expect(cache).toHaveBeenCalledWith(30, "AQID", 10);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://cdns.grindr.com/video",
			expect.objectContaining({ redirect: "error" }),
		);
	});

	it("does not cache partial HTTP responses", async () => {
		const cache = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				status: 206,
				headers: { "content-type": "video/mp4" },
			}),
		);

		await expect(
			resolveBoundedLegacyRemoteVideo("https://cdns.grindr.com/video", 30, {
				fetch: fetchMock,
				cache,
				settings,
				...sessionDependencies,
			}),
		).resolves.toBe("https://cdns.grindr.com/video");
		expect(cache).not.toHaveBeenCalled();
	});

	it("rejects unsafe URLs and falls back without fetching oversized media", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array(), {
				headers: {
					"content-type": "video/mp4",
					"content-length": String(31 * 1024 * 1024),
				},
			}),
		);
		const deps = {
			fetch: fetchMock,
			cache: vi.fn(),
			settings,
			...sessionDependencies,
		};

		await expect(
			resolveBoundedLegacyRemoteVideo("http://media.example/video", 30, deps),
		).resolves.toBeNull();
		await expect(
			resolveBoundedLegacyRemoteVideo("https://media.example/video", 30, deps),
		).resolves.toBeNull();
		await expect(
			resolveBoundedLegacyRemoteVideo(
				"https://evilcloudfront.net/video",
				30,
				deps,
			),
		).resolves.toBeNull();
		await expect(
			resolveBoundedLegacyRemoteVideo(
				"https://d123.cloudfront.net/video",
				30,
				deps,
			),
		).resolves.toBe("https://d123.cloudfront.net/video");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(deps.cache).not.toHaveBeenCalled();
	});

	it("enforces the streaming byte limit when content-length is absent", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array(11 * 1024 * 1024), {
				headers: { "content-type": "video/mp4" },
			}),
		);
		const cache = vi.fn();

		await expect(
			resolveBoundedLegacyRemoteVideo("https://cdns.grindr.com/video", 30, {
				fetch: fetchMock,
				cache,
				...sessionDependencies,
				settings: () => ({
					legacyShortVideoFetchMaxMb: 10,
					legacyShortVideoFetchTimeoutMs: 30_000,
				}),
			}),
		).resolves.toBe("https://cdns.grindr.com/video");
		expect(cache).not.toHaveBeenCalled();
	});

	it("falls back to validated defaults when persisted limits are malformed", async () => {
		const cache = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array(), {
				headers: {
					"content-type": "video/mp4",
					"content-length": String(31 * 1024 * 1024),
				},
			}),
		);

		await expect(
			resolveBoundedLegacyRemoteVideo("https://cdns.grindr.com/video", 30, {
				fetch: fetchMock,
				cache,
				...sessionDependencies,
				settings: () => ({
					legacyShortVideoFetchMaxMb: Number.NaN,
					legacyShortVideoFetchTimeoutMs: Number.POSITIVE_INFINITY,
				}),
			}),
		).resolves.toBe("https://cdns.grindr.com/video");
		expect(cache).not.toHaveBeenCalled();
	});

	it("does not cache account A's delayed fetch after switching to account B", async () => {
		let resolveFetch!: (response: Response) => void;
		const fetchMock = vi.fn(
			() => new Promise<Response>((resolve) => (resolveFetch = resolve)),
		);
		const cache = vi.fn();
		let current = true;
		const pending = resolveBoundedLegacyRemoteVideo(
			"https://cdns.grindr.com/video",
			30,
			{
				fetch: fetchMock,
				cache,
				settings,
				getSession: () => ({ accountId: 10, generation: 1 }),
				isSessionCurrent: () => current,
			},
		);
		current = false;
		resolveFetch(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "video/mp4", "content-length": "3" },
			}),
		);

		await expect(pending).resolves.toBeNull();
		expect(cache).not.toHaveBeenCalled();
	});
});
