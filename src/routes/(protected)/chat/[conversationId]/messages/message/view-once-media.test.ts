import { describe, expect, it, vi } from "vitest";

import {
	ExplicitViewOnceMediaSource,
	StableExplicitViewOnceMediaSource,
} from "./view-once-media";

const entry = {
	accountProfileId: 1,
	conversationId: "1:2",
	peerProfileId: 2,
	messageId: "message",
	mediaId: "media",
	kind: "image" as const,
	messageType: "ExpiringImage" as const,
	sentAt: 100,
	remoteAvailability: "available" as const,
	cacheAvailability: "not_cached" as const,
	cacheToken: null,
	consumptive: true,
	remoteUrl: null,
};

describe("ExplicitViewOnceMediaSource", () => {
	it("preserves exact-once authorization across equivalent reconciled props", async () => {
		const authorize = vi.fn().mockResolvedValue({
			url: "https://media.example/authorized",
			contentType: "image/jpeg",
		});
		const stable = new StableExplicitViewOnceMediaSource({
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain: vi.fn().mockResolvedValue(null),
		});

		await expect(stable.forEntry(entry)?.open(authorize)).resolves.toBe(
			"https://media.example/authorized",
		);
		await expect(
			stable.forEntry({ ...entry, sentAt: entry.sentAt + 1 })?.open(authorize),
		).resolves.toBe("https://media.example/authorized");
		expect(authorize).toHaveBeenCalledOnce();
	});

	it("creates a fresh authorization boundary for a different media identity", () => {
		const stable = new StableExplicitViewOnceMediaSource({
			lookup: vi.fn(),
			retain: vi.fn(),
		});
		const original = stable.forEntry(entry);
		const changed = stable.forEntry({ ...entry, mediaId: "other-media" });

		expect(changed).not.toBe(original);
	});

	it("replays an encrypted cached copy without authorizing", async () => {
		const authorize = vi.fn();
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({
				found: true,
				protocolUrl: "direct-media-cache://localhost/opaque",
			}),
			retain: vi.fn(),
		});

		await expect(source.open(authorize)).resolves.toBe(
			"direct-media-cache://localhost/opaque",
		);
		expect(authorize).not.toHaveBeenCalled();
	});

	it("authorizes once and returns retained media on repeated opens", async () => {
		const authorize = vi.fn().mockResolvedValue({
			url: "https://media.example/authorized",
			contentType: "image/jpeg",
		});
		const retain = vi
			.fn()
			.mockResolvedValue("direct-media-cache://localhost/retained");
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain,
		});

		await expect(source.open(authorize)).resolves.toBe(
			"direct-media-cache://localhost/retained",
		);
		await expect(source.open(authorize)).resolves.toBe(
			"direct-media-cache://localhost/retained",
		);
		expect(authorize).toHaveBeenCalledOnce();
		expect(retain).toHaveBeenCalledOnce();
	});

	it("shares one authorization across concurrent explicit opens", async () => {
		let resolveAuthorization:
			| ((media: { url: string; contentType: string }) => void)
			| undefined;
		const authorize = vi.fn(
			() =>
				new Promise<{ url: string; contentType: string }>((resolve) => {
					resolveAuthorization = resolve;
				}),
		);
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain: vi
				.fn()
				.mockResolvedValue("direct-media-cache://localhost/retained"),
		});

		const first = source.open(authorize);
		const second = source.open(authorize);
		await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
		resolveAuthorization?.({
			url: "https://media.example/authorized",
			contentType: "image/jpeg",
		});
		await expect(Promise.all([first, second])).resolves.toEqual([
			"direct-media-cache://localhost/retained",
			"direct-media-cache://localhost/retained",
		]);
	});

	it("keeps the authorized in-memory URL when retention fails", async () => {
		const authorize = vi.fn().mockResolvedValue({
			url: "https://media.example/authorized",
			contentType: "video/mp4",
		});
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain: vi.fn().mockRejectedValue(new Error("cache unavailable")),
		});

		await expect(source.open(authorize)).resolves.toBe(
			"https://media.example/authorized",
		);
		await expect(source.open(authorize)).resolves.toBe(
			"https://media.example/authorized",
		);
		expect(authorize).toHaveBeenCalledOnce();
	});

	it("does not authorize exhausted media when no cached copy exists", async () => {
		const authorize = vi.fn();
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain: vi.fn(),
		});

		await expect(source.open(authorize, false)).resolves.toBeNull();
		expect(authorize).not.toHaveBeenCalled();
	});

	it("does not memoize a nonauthorizing cache miss", async () => {
		const lookup = vi
			.fn()
			.mockResolvedValueOnce({ found: false })
			.mockResolvedValueOnce({
				found: true,
				protocolUrl: "direct-media-cache://localhost/later",
			});
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup,
			retain: vi.fn(),
		});

		await expect(source.open(vi.fn(), false)).resolves.toBeNull();
		await expect(source.open(vi.fn(), false)).resolves.toBe(
			"direct-media-cache://localhost/later",
		);
		expect(lookup).toHaveBeenCalledTimes(2);
	});

	it("shares concurrent explicit authorization and fails closed after rejection", async () => {
		const authorize = vi.fn().mockRejectedValue(new Error("ambiguous"));
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockResolvedValue({ found: false }),
			retain: vi.fn(),
		});

		const first = source.open(authorize);
		const second = source.open(authorize);
		await expect(first).rejects.toThrow("ambiguous");
		await expect(second).rejects.toThrow("ambiguous");
		await expect(source.open(authorize)).rejects.toThrow("ambiguous");
		expect(authorize).toHaveBeenCalledOnce();
	});

	it("still authorizes once when the cache lookup is unavailable", async () => {
		const authorize = vi.fn().mockResolvedValue({
			url: "https://media.example/authorized",
			contentType: "image/jpeg",
		});
		const source = new ExplicitViewOnceMediaSource(entry, {
			lookup: vi.fn().mockRejectedValue(new Error("cache unavailable")),
			retain: vi.fn().mockRejectedValue(new Error("cache unavailable")),
		});

		await expect(source.open(authorize)).resolves.toBe(
			"https://media.example/authorized",
		);
		expect(authorize).toHaveBeenCalledOnce();
	});
});
