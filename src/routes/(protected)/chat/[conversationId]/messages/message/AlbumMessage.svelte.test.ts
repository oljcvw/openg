// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AlbumMessage from "./AlbumMessage.svelte";

type LightboxHandler = () => void;
type LightboxFilter = (...args: unknown[]) => unknown;

type PhotoSwipeHarness = {
	currIndex: number;
	getNumItems: () => number;
	on: (name: string, handler: LightboxHandler) => void;
	ui: { registerElement: (element: RegisteredElement | null) => void };
};

type RegisteredElement = {
	name?: string;
	onInit?: (element: HTMLElement, pswp: PhotoSwipeHarness) => void;
};

const harness = vi.hoisted(
	(): {
		handlers: Map<string, LightboxHandler[]>;
		filters: Map<string, LightboxFilter>;
		registeredElement: RegisteredElement | null;
		pswp: PhotoSwipeHarness;
	} => ({
		handlers: new Map<string, LightboxHandler[]>(),
		filters: new Map<string, LightboxFilter>(),
		registeredElement: null,
		pswp: {
			currIndex: 0,
			getNumItems: () => 3,
			on(name: string, handler: LightboxHandler) {
				harness.handlers.set(name, [
					...(harness.handlers.get(name) ?? []),
					handler,
				]);
			},
			ui: {
				registerElement(element: RegisteredElement | null) {
					harness.registeredElement = element;
				},
			},
		},
	}),
);

vi.mock("photoswipe/lightbox", () => ({
	default: class PhotoSwipeLightboxMock {
		pswp = harness.pswp;

		addFilter(name: string, filter: LightboxFilter) {
			harness.filters.set(name, filter);
		}

		on(name: string, handler: LightboxHandler) {
			harness.handlers.set(name, [
				...(harness.handlers.get(name) ?? []),
				handler,
			]);
		}

		init() {
			for (const handler of harness.handlers.get("uiRegister") ?? []) handler();
		}

		loadAndOpen() {}

		destroy() {}
	},
}));

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$lib/api/messaging/albums", () => ({
	getAlbumContent: vi.fn().mockResolvedValue({
		albumId: 7,
		albumName: null,
		profileId: 42,
		albumViewable: true,
		sharedCount: 1,
		createdAt: "2026-08-03T12:00:00Z",
		updatedAt: "2026-08-03T12:00:00Z",
		content: [
			{
				contentId: 1,
				contentType: "image/jpeg",
				coverUrl: null,
				statusId: 1,
				thumbUrl: "https://example.test/1-thumb.jpg",
				url: "https://example.test/1.jpg",
				processing: null,
				rejectionId: null,
			},
			{
				contentId: 2,
				contentType: "video/mp4",
				coverUrl: "https://example.test/2-cover.jpg",
				statusId: 1,
				thumbUrl: "https://example.test/2-thumb.jpg",
				url: "https://example.test/2.mp4",
				processing: null,
				rejectionId: null,
			},
			{
				contentId: 3,
				contentType: "image/jpeg",
				coverUrl: null,
				statusId: 1,
				thumbUrl: "https://example.test/3-thumb.jpg",
				url: "https://example.test/3.jpg",
				processing: true,
				rejectionId: null,
			},
		],
	}),
	recordAlbumContentView: vi.fn(),
}));
vi.mock("$lib/app-data/album-cache", () => ({
	discoverSharedAlbum: vi.fn().mockResolvedValue(undefined),
	markAlbumUnavailable: vi.fn(),
	readCachedAlbum: vi.fn().mockResolvedValue(null),
	resolveCachedAlbum: vi.fn(),
	retainViewedAlbumContent: vi.fn(),
	subscribeCachedAlbum: vi.fn(() => vi.fn()),
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({
		albumPreloadConcurrency: 2,
		albumPreloadTimeoutMs: 12_345,
	}),
	getKeepUnavailableCachedAlbumsSnapshot: () => false,
	subscribePreferences: () => vi.fn(),
}));
vi.mock("$lib/platform/back-gesture-event.svelte", () => ({
	backGestureEventHandlers: new Set(),
}));
vi.mock("$lib/util/now.svelte", () => ({
	getNow: () => Date.now(),
	subscribeNow: () => vi.fn(),
}));
vi.mock("./album-media-preload", () => ({
	preloadAlbumSlides: vi.fn((content: object[]) =>
		Promise.resolve(
			content.map((item) => ({ ...item, width: 1080, height: 1920 })),
		),
	),
}));
vi.mock("./message-media.svelte", () => ({
	MessageMediaState: class {
		clone = false;
		cornerClass = "";
		el = null;
		adornments = null;
	},
}));

const message = {
	albumId: 7,
	hasUnseenContent: false,
	expiresAt: null,
	expirationType: "INDEFINITE",
	coverUrl: "https://example.test/cover.jpg",
	ownerProfileId: 42,
	isViewable: true,
	hasVideo: true,
	hasPhoto: true,
	viewableUntil: null,
};

describe("AlbumMessage media position", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		harness.handlers.clear();
		harness.filters.clear();
		harness.registeredElement = null;
		harness.pswp.currIndex = 0;
	});

	afterEach(() => cleanup());

	it("only treats the album owner as proven for an incoming active-peer message", async () => {
		const { discoverSharedAlbum } = await import("$lib/app-data/album-cache");
		render(AlbumMessage, {
			message,
			senderProfileId: 42,
			peerProfileId: 42,
			isOut: false,
		});

		await waitFor(() =>
			expect(discoverSharedAlbum).toHaveBeenCalledWith(
				expect.objectContaining({ ownerProfileId: 42, ownerValidated: true }),
			),
		);
	});

	it("does not prove album ownership from an outgoing or mismatched sender", async () => {
		const { discoverSharedAlbum } = await import("$lib/app-data/album-cache");
		render(AlbumMessage, {
			message,
			senderProfileId: 42,
			peerProfileId: 42,
			isOut: true,
		});

		await waitFor(() => expect(discoverSharedAlbum).toHaveBeenCalledOnce());
		expect(discoverSharedAlbum).toHaveBeenCalledWith(
			expect.objectContaining({ ownerValidated: false }),
		);
	});

	it("preserves once-view order and count without speculative preload", async () => {
		const { preloadAlbumSlides } = await import("./album-media-preload");
		const { getByRole } = render(AlbumMessage, {
			message: { ...message, expirationType: "ONCE" },
		});

		await fireEvent.click(getByRole("button"));
		await waitFor(() => expect(harness.filters.get("numItems")).toBeDefined());

		expect(preloadAlbumSlides).not.toHaveBeenCalled();
		expect(harness.filters.get("numItems")?.()).toBe(3);
		const itemData = harness.filters.get("itemData");
		expect(itemData?.({}, 0)).toMatchObject({
			src: "https://example.test/1.jpg",
			width: 1,
			height: 1,
		});
		expect(itemData?.({}, 1)).toMatchObject({
			src: "https://example.test/2.mp4",
			width: 1,
			height: 1,
		});
		expect(itemData?.({}, 2)).toMatchObject({
			html: expect.stringContaining("not cached"),
			width: 1,
			height: 1,
		});
		const { recordAlbumContentView } =
			await import("$lib/api/messaging/albums");
		harness.pswp.currIndex = 2;
		for (const handler of harness.handlers.get("afterInit") ?? []) handler();
		expect(recordAlbumContentView).not.toHaveBeenCalled();
	});

	it("registers an accessible position indicator for mixed album media", async () => {
		const { getByRole } = render(AlbumMessage, { message });

		await fireEvent.click(getByRole("button"));
		await waitFor(() => expect(harness.registeredElement).not.toBeNull());
		const { preloadAlbumSlides } = await import("./album-media-preload");
		expect(preloadAlbumSlides).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				concurrency: 2,
				timeoutMs: 12_345,
				signal: expect.any(AbortSignal),
			}),
		);

		const indicator = document.createElement("div");
		harness.registeredElement?.onInit?.(indicator, harness.pswp);

		expect(harness.registeredElement?.name).toBe("album-position");
		expect(indicator.textContent).toBe("1 / 3");
		expect(indicator.getAttribute("role")).toBe("status");
		expect(indicator.getAttribute("aria-live")).toBe("polite");
		expect(indicator.getAttribute("aria-atomic")).toBe("true");

		harness.pswp.currIndex = 1;
		for (const handler of harness.handlers.get("change") ?? []) handler();
		expect(indicator.textContent).toBe("2 / 3");

		harness.pswp.currIndex = 2;
		for (const handler of harness.handlers.get("change") ?? []) handler();
		expect(indicator.textContent).toBe("3 / 3");
	});

	it("refetches a remote album each time the viewer is reopened", async () => {
		const { getAlbumContent } = await import("$lib/api/messaging/albums");
		const { getByRole } = render(AlbumMessage, { message });

		await fireEvent.click(getByRole("button"));
		await waitFor(() => expect(getAlbumContent).toHaveBeenCalledTimes(1));
		for (const handler of harness.handlers.get("closingAnimationEnd") ?? [])
			handler();
		await waitFor(() =>
			expect((getByRole("button") as HTMLButtonElement).disabled).toBe(false),
		);

		await fireEvent.click(getByRole("button"));
		await waitFor(() => expect(getAlbumContent).toHaveBeenCalledTimes(2));
	});
});
