import { cleanup, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeOwnershipSnapshot } from "$lib/dev/runtime-ownership";
import Harness from "./MessagesList.test-harness.svelte";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function message(index: number) {
	return {
		messageId: `message-${index}`,
		conversationId: "conversation",
		senderId: 1,
		timestamp: index,
		unsent: false,
		reactions: [],
		type: "Text" as const,
		body: { text: `message ${index}` },
		status: "sent" as const,
	};
}

describe("MessagesList virtualization", () => {
	it("mounts fewer than 150 stable message rows for a 5,000-message transcript", async () => {
		const baseline = getRuntimeOwnershipSnapshot();
		const state = {
			messages: Array.from({ length: 5_000 }, (_, index) => message(index)),
			ourProfileId: 1,
			profile: null,
			lastReadTimestamp: null,
			pageKey: null,
			loadingMore: false,
			locateMessage: () => Promise.resolve(null),
			loadMore: () => Promise.resolve("end" as const),
		};

		const { container, unmount } = render(Harness, { state });
		await tick();

		const mounted = container.querySelectorAll("[data-message-id]");
		expect(mounted.length).toBeGreaterThan(0);
		expect(mounted.length).toBeLessThan(150);
		expect(
			new Set([...mounted].map((row) => row.getAttribute("data-message-id")))
				.size,
		).toBe(mounted.length);
		unmount();
		expect(getRuntimeOwnershipSnapshot()).toEqual(baseline);
	});

	it("reactivates an adjacent newer segment when the user reaches the active end", async () => {
		const loadNewer = vi.fn(() => Promise.resolve("loaded" as const));
		const state = {
			messages: [message(1)],
			ourProfileId: 1,
			profile: null,
			lastReadTimestamp: null,
			pageKey: null,
			loadingMore: false,
			loadingNewer: false,
			newerSegmentId: "newer-segment",
			locateMessage: () => Promise.resolve(null),
			loadMore: () => Promise.resolve("end" as const),
			loadNewer,
		};

		render(Harness, { state });
		await waitFor(() => expect(loadNewer).toHaveBeenCalledOnce());
	});

	it("locates a far saved message before virtual scrolling", async () => {
		const locateMessage = vi.fn(() => Promise.resolve(2_500));
		const onScrolled = vi.fn();
		const state = {
			messages: Array.from({ length: 5_000 }, (_, index) => message(index)),
			ourProfileId: 1,
			profile: null,
			lastReadTimestamp: null,
			pageKey: null,
			loadingMore: false,
			loadingNewer: false,
			newerSegmentId: null,
			locateMessage,
			loadMore: () => Promise.resolve("end" as const),
			loadNewer: () => Promise.resolve("end" as const),
		};

		render(Harness, {
			state,
			scrollToMessageId: "message-2500",
			onScrolled,
		});
		await waitFor(() =>
			expect(locateMessage).toHaveBeenCalledWith("message-2500"),
		);
		await waitFor(() => expect(onScrolled).toHaveBeenCalledWith(true));
	});

	it("defers a visible incoming read receipt until transcript restoration completes", async () => {
		type ObserverCallback = ConstructorParameters<
			typeof IntersectionObserver
		>[0];
		const callbacks: ObserverCallback[] = [];
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: ObserverCallback) {
					callbacks.push(callback);
				}
				disconnect = vi.fn();
				observe = vi.fn();
				unobserve = vi.fn();
				takeRecords = vi.fn(() => []);
				root = null;
				rootMargin = "0px";
				thresholds = [0];
			},
		);
		const reportIncomingVisible = vi.fn();
		const incoming = { ...message(1), senderId: 2 };
		const state = {
			messages: [incoming],
			ourProfileId: 1,
			profile: { profileId: 2, name: "Peer" },
			lastReadTimestamp: null,
			pageKey: null,
			loadingMore: false,
			loadingNewer: false,
			newerSegmentId: null,
			locateMessage: () => Promise.resolve(null),
			loadMore: () => Promise.resolve("end" as const),
			loadNewer: () => Promise.resolve("end" as const),
			reportIncomingVisible,
		};

		const view = render(Harness, {
			state,
			readReportingEnabled: false,
		});
		await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
		for (const callback of callbacks) {
			callback(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			);
		}
		await tick();
		expect(reportIncomingVisible).not.toHaveBeenCalled();

		await view.rerender({ state, readReportingEnabled: true });
		await waitFor(() => expect(reportIncomingVisible).toHaveBeenCalledOnce());
		expect(reportIncomingVisible).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: incoming.conversationId,
				messageId: incoming.messageId,
				senderId: incoming.senderId,
			}),
		);
	});
});
