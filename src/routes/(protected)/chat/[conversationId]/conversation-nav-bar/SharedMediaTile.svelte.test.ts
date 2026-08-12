// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SharedMediaEntry } from "$lib/chat/shared-media";
import SharedMediaTile from "./SharedMediaTile.svelte";

vi.mock("$lib/app-data/direct-media-cache", () => ({
	lookupDirectMedia: vi.fn(() =>
		Promise.resolve({ found: true, protocolUrl: "direct-media://cached" }),
	),
}));

vi.mock("$lib/app-data/direct-media-retention", () => ({
	queueVisibleDirectMedia: vi.fn(() => Promise.resolve(null)),
}));

afterEach(cleanup);

const entry: SharedMediaEntry = {
	accountProfileId: 7,
	conversationId: "conversation",
	peerProfileId: 42,
	messageId: "message-1",
	mediaId: "media-1",
	kind: "image",
	messageType: "ExpiringImage",
	sentAt: 1,
	remoteAvailability: "available",
	cacheAvailability: "cached",
	cacheToken: "cache-token",
	consumptive: true,
	remoteUrl: "https://must-not-be-rendered.example/signed",
};

describe("SharedMediaTile resolved URL ownership", () => {
	it("releases its resolved URL when virtual eviction unmounts the tile", async () => {
		const onResolved = vi.fn();
		const onReleased = vi.fn();
		const view = render(SharedMediaTile, {
			entry,
			onOpen: vi.fn(),
			onResolved,
			onReleased,
		});

		await waitFor(() =>
			expect(onResolved).toHaveBeenCalledWith("direct-media://cached"),
		);
		view.unmount();
		expect(onReleased).toHaveBeenCalledWith("message-1");
	});

	it("never renders a speculative consumptive remote URL", async () => {
		const view = render(SharedMediaTile, {
			entry: { ...entry, cacheAvailability: "not_cached", cacheToken: null },
			onOpen: vi.fn(),
		});
		await waitFor(() =>
			expect(view.container.querySelector("img")?.getAttribute("src")).not.toBe(
				entry.remoteUrl,
			),
		);
	});
});
