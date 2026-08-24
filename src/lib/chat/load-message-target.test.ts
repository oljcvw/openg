import { describe, expect, it, vi } from "vitest";

import { loadMessageTarget } from "$lib/chat/load-message-target";

describe("loadMessageTarget", () => {
	it("loads pages until the requested message appears", async () => {
		let cursor: string | null = "page-2";
		const messages = new Set<string>();
		const loadMore = vi.fn(() => {
			if (cursor === "page-2") cursor = "page-3";
			else {
				messages.add("target");
				cursor = null;
			}
			return Promise.resolve();
		});

		await expect(
			loadMessageTarget({
				messageId: "target",
				hasMessage: (id) => messages.has(id),
				pageKey: () => cursor,
				loading: () => false,
				loadMore,
			}),
		).resolves.toBe(true);
		expect(loadMore).toHaveBeenCalledTimes(2);
	});

	it("does not load when the message is already present", async () => {
		const loadMore = vi.fn<() => Promise<void>>();
		await expect(
			loadMessageTarget({
				messageId: "target",
				hasMessage: () => true,
				pageKey: () => "page-2",
				loading: () => false,
				loadMore,
			}),
		).resolves.toBe(true);
		expect(loadMore).not.toHaveBeenCalled();
	});

	it("stops when pagination does not advance", async () => {
		const loadMore = vi.fn(() => Promise.resolve());
		await expect(
			loadMessageTarget({
				messageId: "missing",
				hasMessage: () => false,
				pageKey: () => "stuck",
				loading: () => false,
				loadMore,
			}),
		).resolves.toBe(false);
		expect(loadMore).toHaveBeenCalledOnce();
	});

	it("waits for pagination already in progress", async () => {
		let loading = true;
		let present = false;
		const loadMore = vi.fn(() => Promise.resolve());
		const waitForWork = vi.fn(() => {
			present = true;
			loading = false;
			return Promise.resolve();
		});

		await expect(
			loadMessageTarget({
				messageId: "target",
				hasMessage: () => present,
				pageKey: () => "page-2",
				loading: () => loading,
				loadMore,
				waitForWork,
			}),
		).resolves.toBe(true);
		expect(waitForWork).toHaveBeenCalledOnce();
	});

	it("stops when navigation makes the request stale", async () => {
		let current = true;
		await expect(
			loadMessageTarget({
				messageId: "target",
				hasMessage: () => false,
				pageKey: () => "page-2",
				loading: () => false,
				loadMore: () => {
					current = false;
					return Promise.resolve();
				},
				isCurrent: () => current,
			}),
		).resolves.toBe(false);
	});
});
