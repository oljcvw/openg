// @vitest-environment jsdom

import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AlbumMessage from "./AlbumMessage.svelte";

type LightboxHandler = () => void;

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
		registeredElement: RegisteredElement | null;
		pswp: PhotoSwipeHarness;
	} => ({
		handlers: new Map<string, LightboxHandler[]>(),
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

		addFilter() {}

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
				processing: null,
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
	getDeveloperSettingsSnapshot: () => ({ albumPreloadConcurrency: 2 }),
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
		harness.handlers.clear();
		harness.registeredElement = null;
		harness.pswp.currIndex = 0;
	});

	it("registers an accessible position indicator for mixed album media", async () => {
		const { getByRole } = render(AlbumMessage, { message });

		await fireEvent.click(getByRole("button"));
		await waitFor(() => expect(harness.registeredElement).not.toBeNull());

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
});
