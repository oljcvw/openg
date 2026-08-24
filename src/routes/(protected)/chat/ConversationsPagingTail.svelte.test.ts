// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "$lib/api/api-error";
import { InboxPaging } from "$lib/chat/inbox-paging.svelte";
import ConversationsPagingTail from "./ConversationsPagingTail.svelte";

class FakeIntersectionObserver {
	static latest: FakeIntersectionObserver | null = null;
	#callback: IntersectionObserverCallback;
	#node: Element | null = null;

	constructor(callback: IntersectionObserverCallback) {
		this.#callback = callback;
		FakeIntersectionObserver.latest = this;
	}

	observe(node: Element) {
		this.#node = node;
		this.#deliver();
	}

	reenter() {
		this.#deliver();
	}

	#deliver() {
		queueMicrotask(() =>
			this.#callback(
				[
					{
						isIntersecting: true,
						target: this.#node,
					} as unknown as IntersectionObserverEntry,
				],
				this as unknown as IntersectionObserver,
			),
		);
	}

	unobserve() {}
	disconnect() {}
}

const retryableFailure = () =>
	new ApiError({
		message: "server down",
		request: { method: "POST", path: "/v4/inbox" },
		kind: "Http",
	});

function mount({
	loadPage = () => Promise.resolve(),
	listEmpty = false,
	hasMore = true,
	query = "",
	searchingHistory = false,
	searchFailure = null,
	onSearchRetry,
}: {
	loadPage?: (page: number) => Promise<void>;
	listEmpty?: boolean;
	hasMore?: boolean;
	query?: string;
	searchingHistory?: boolean;
	searchFailure?: Error | null;
	onSearchRetry?: () => void;
} = {}) {
	const paging = new InboxPaging({ loadPage, cursor: () => 2 });
	const rendered = render(ConversationsPagingTail, {
		paging,
		hasMore,
		listEmpty,
		filtered: false,
		query,
		searchingHistory,
		searchFailure,
		onSearchRetry,
	});
	return { paging, ...rendered };
}

const skeletonCount = (container: HTMLElement) =>
	container.querySelectorAll('[data-slot="skeleton"]').length;

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("ConversationsPagingTail", () => {
	it("shows skeletons instead of nothing while an empty list has pages left", () => {
		const { container } = mount({ listEmpty: true });

		expect(skeletonCount(container)).toBe(8);
	});

	it("leaves a settled list alone when there is nothing more to load", async () => {
		const { container } = mount({ listEmpty: false, hasMore: false });
		await vi.advanceTimersByTimeAsync(0);

		expect(skeletonCount(container)).toBe(0);
	});

	it("offers a retry row instead of nothing when a page fails", async () => {
		const { container } = mount({
			listEmpty: true,
			loadPage: () => Promise.reject(retryableFailure()),
		});

		await vi.advanceTimersByTimeAsync(0);

		expect(container.textContent?.trim()).not.toBe("");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(skeletonCount(container)).toBe(0);
	});

	it("retries a failed page without needing a scroll", async () => {
		const loadPage = vi
			.fn<(page: number) => Promise<void>>()
			.mockRejectedValueOnce(retryableFailure())
			.mockResolvedValue(undefined);
		mount({ loadPage });

		await vi.advanceTimersByTimeAsync(0);
		expect(loadPage).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(2_000);

		expect(loadPage).toHaveBeenCalledTimes(2);
	});

	it("does not re-fire while the failure is on screen", async () => {
		const loadPage = vi.fn(() => Promise.reject(retryableFailure()));
		mount({ loadPage });

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1_999);

		expect(loadPage).toHaveBeenCalledTimes(1);
	});

	it("does not re-fire when a load settles without moving the cursor", async () => {
		const loadPage = vi.fn(() => Promise.resolve());
		mount({ loadPage });

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(loadPage).toHaveBeenCalledTimes(1);
	});

	it("stays quiet when layout shifts re-deliver the sentinel while failed", async () => {
		const loadPage = vi.fn(() => Promise.reject(retryableFailure()));
		mount({ loadPage });
		await vi.advanceTimersByTimeAsync(0);
		expect(loadPage).toHaveBeenCalledTimes(1);

		FakeIntersectionObserver.latest?.reenter();
		await vi.advanceTimersByTimeAsync(0);
		FakeIntersectionObserver.latest?.reenter();
		await vi.advanceTimersByTimeAsync(0);

		expect(loadPage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("shows the settled empty state when there is nothing at all", () => {
		mount({ listEmpty: true, hasMore: false });

		expect(screen.getByText("No Conversations Yet")).toBeTruthy();
	});

	it("shows the search-specific empty state after every page is checked", () => {
		mount({ listEmpty: true, hasMore: false, query: "lost words" });

		expect(screen.getByText("No matching conversations")).toBeTruthy();
		expect(
			screen.getByText("No names or messages match “lost words”."),
		).toBeTruthy();
	});

	it("keeps the empty state pending while message history is searched", () => {
		const { container } = mount({
			listEmpty: true,
			hasMore: false,
			query: "deep words",
			searchingHistory: true,
		});

		expect(screen.queryByText("No matching conversations")).toBeNull();
		expect(screen.getByRole("status").textContent?.trim()).toBe(
			"Searching message history",
		);
		expect(skeletonCount(container)).toBe(8);
	});

	it("offers the search retry callback when history loading fails", () => {
		const onSearchRetry = vi.fn();
		mount({
			listEmpty: true,
			hasMore: false,
			searchFailure: new Error("offline"),
			onSearchRetry,
		});

		expect(screen.getByRole("status").textContent?.trim()).toBe(
			"Failed to search message history",
		);
		screen.getByRole("button", { name: "Retry" }).click();
		expect(onSearchRetry).toHaveBeenCalledOnce();
	});

	it("shows six skeletons below existing rows while a page loads", async () => {
		const { container } = mount({
			listEmpty: false,
			loadPage: () => new Promise(() => {}),
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(skeletonCount(container)).toBe(6);
	});

	it("announces loading and failure to screen readers", async () => {
		const loadPage = vi
			.fn<(page: number) => Promise<void>>()
			.mockRejectedValueOnce(retryableFailure())
			.mockImplementation(() => new Promise(() => {}));
		mount({ loadPage });
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByRole("status").textContent?.trim()).toBe(
			"Failed to load more conversations",
		);

		screen.getByRole("button", { name: "Retry" }).click();
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByRole("status").textContent?.trim()).toBe(
			"Loading more conversations",
		);
	});

	it("recovers on a tap of Retry", async () => {
		const loadPage = vi
			.fn<(page: number) => Promise<void>>()
			.mockRejectedValueOnce(retryableFailure())
			.mockResolvedValue(undefined);
		const { container } = mount({ loadPage });
		await vi.advanceTimersByTimeAsync(0);

		screen.getByRole("button", { name: "Retry" }).click();
		await vi.advanceTimersByTimeAsync(0);

		expect(loadPage).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(skeletonCount(container)).toBe(0);
	});
});
