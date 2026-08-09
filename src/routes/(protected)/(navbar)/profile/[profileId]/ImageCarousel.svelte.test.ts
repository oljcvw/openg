// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
import ImageCarousel from "./ImageCarousel.svelte";

const lightboxHarness = vi.hoisted(() => ({
	handlers: new Map<string, () => void>(),
	options: null as Record<string, unknown> | null,
	pswp: {
		currIndex: 0,
		currSlide: undefined as
			| { data: { element?: HTMLElement }; index: number }
			| undefined,
	},
}));

vi.mock("photoswipe/lightbox", () => ({
	default: class PhotoSwipeLightboxMock {
		pswp = lightboxHarness.pswp;

		constructor(options: Record<string, unknown>) {
			lightboxHarness.options = options;
		}

		addFilter() {}

		on(name: string, handler: () => void) {
			lightboxHarness.handlers.set(name, handler);
		}

		init() {}

		destroy() {}
	},
}));

const medias = [
	{ mediaHash: "photo-1", takenOnGrindr: null, createdAt: null },
	{ mediaHash: "photo-2", takenOnGrindr: null, createdAt: null },
	{ mediaHash: "photo-3", takenOnGrindr: null, createdAt: null },
];

async function renderCarousel() {
	const result = render(ImageCarousel, { medias });
	await waitFor(() => expect(lightboxHarness.options).not.toBeNull());
	return result;
}

describe("ImageCarousel profile photo interaction", () => {
	beforeEach(() => {
		lightboxHarness.handlers.clear();
		lightboxHarness.options = null;
		lightboxHarness.pswp.currIndex = 0;
		lightboxHarness.pswp.currSlide = undefined;
	});

	it("uses a 70% photo viewport with native vertical photo paging", async () => {
		const { container } = await renderCarousel();
		const surface = container.querySelector<HTMLElement>(
			"[data-profile-swipe-surface]",
		);
		const carousel = container.querySelector<HTMLElement>(
			"[data-profile-photo-carousel]",
		);

		expect(surface?.getAttribute("style")).toContain("0.7");
		expect(carousel).not.toBeNull();
		expect(window.getComputedStyle(carousel!).overflowY).toBe("auto");
		expect(window.getComputedStyle(carousel!).overscrollBehaviorY).toBe("auto");
	});

	it("closes expanded photos on the first tap without waiting for double tap", async () => {
		const { container } = await renderCarousel();

		expect(lightboxHarness.options).toMatchObject({
			doubleTapAction: false,
			imageClickAction: "close",
			loop: false,
			tapAction: "close",
		});
		expect(
			[...container.querySelectorAll<HTMLAnchorElement>(".item")].map((item) =>
				item.getAttribute("aria-label"),
			),
		).toEqual(["Open photo 1 of 3", "Open photo 2 of 3", "Open photo 3 of 3"]);
	});

	it("keeps the minimized carousel on the expanded photo selected before close", async () => {
		const { container } = await renderCarousel();
		const carousel = container.querySelector<HTMLElement>(
			"[data-profile-photo-carousel]",
		)!;
		Object.defineProperty(carousel, "clientHeight", {
			configurable: true,
			value: 700,
		});
		const scrollTo = vi.fn();
		carousel.scrollTo = scrollTo;
		lightboxHarness.pswp.currIndex = 2;

		lightboxHarness.handlers.get("change")?.();

		expect(scrollTo).toHaveBeenCalledWith({
			behavior: "auto",
			top: 1400,
		});
	});

	it("releases its Back handler when the profile is replaced while open", async () => {
		const baseline = backGestureEventHandlers.size;
		const { unmount } = await renderCarousel();
		lightboxHarness.handlers.get("beforeOpen")?.();
		expect(backGestureEventHandlers.size).toBe(baseline + 1);

		unmount();

		expect(backGestureEventHandlers.size).toBe(baseline);
	});
});
