// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SharedMediaEntry } from "$lib/chat/shared-media";
import SharedMediaTile from "./SharedMediaTile.svelte";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("$lib/app-data/direct-media-cache", () => ({
	lookupDirectMedia: lookupMock,
}));
vi.mock("$lib/app-data/direct-media-retention", () => ({
	queueVisibleDirectMedia: vi.fn().mockResolvedValue(null),
}));

afterEach(() => {
	cleanup();
	lookupMock.mockReset();
});

function entry(messageId: string): SharedMediaEntry {
	return {
		accountProfileId: 1,
		conversationId: "1:2",
		peerProfileId: 2,
		messageId,
		mediaId: messageId,
		kind: "image",
		messageType: "ExpiringImage",
		sentAt: 1,
		remoteAvailability: "available",
		cacheAvailability: "not_cached",
		cacheToken: null,
		consumptive: true,
		remoteUrl: `https://media.example/${messageId}`,
	};
}

describe("SharedMediaTile", () => {
	it("never resolves a speculative consumptive URL and ignores a stale lookup", async () => {
		let resolveFirst:
			| ((value: { found: true; protocolUrl: string }) => void)
			| undefined;
		lookupMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({ found: false });
		const onResolved = vi.fn();
		const rendered = render(SharedMediaTile, {
			props: { entry: entry("a"), onOpen: vi.fn(), onResolved },
		});

		await rendered.rerender({
			entry: entry("b"),
			onOpen: vi.fn(),
			onResolved,
		});
		resolveFirst?.({
			found: true,
			protocolUrl: "direct-media-cache://localhost/stale",
		});
		await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(2));

		expect(onResolved).not.toHaveBeenCalledWith("https://media.example/a");
		expect(onResolved).not.toHaveBeenCalledWith("https://media.example/b");
		expect(onResolved).not.toHaveBeenCalledWith(
			"direct-media-cache://localhost/stale",
		);
		expect(rendered.container.querySelector("img, video")).toBeNull();
	});
});
