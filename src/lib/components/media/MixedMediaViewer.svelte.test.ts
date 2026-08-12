// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backLayerManager } from "$lib/navigation/app-navigation";
import MixedMediaViewer from "./MixedMediaViewer.svelte";

const reportViewerDiagnosticMock = vi.hoisted(() => vi.fn());
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportViewerDiagnostic: reportViewerDiagnosticMock,
}));

type Handler = (event?: unknown) => void;
type Filter = (...args: never[]) => unknown;
type TestPswp = {
	currIndex: number;
	element: HTMLElement;
	opener: { isOpening: boolean };
	getNumItems: () => number;
	on: (name: string, handler: Handler) => void;
	close: () => void;
	refreshSlideContent: (index: number) => void;
	goTo: (index: number) => void;
	updateSize: () => void;
	ui: { registerElement: (element: RegisteredElement | null) => void };
};
type RegisteredElement = {
	name: string;
	onInit: (element: HTMLElement, pswp: TestPswp) => void;
};

const harness = vi.hoisted(() => ({
	handlers: new Map<string, Handler[]>(),
	filters: new Map<string, Filter>(),
	loadedIndex: -1,
	options: null as Record<string, unknown> | null,
	refreshedIndex: -1,
	registered: null as RegisteredElement | null,
	initCount: 0,
	goToIndex: -1,
	pswp: {
		currIndex: 0,
		element: document.createElement("div"),
		opener: { isOpening: false },
		getNumItems: () => 3,
		on(name: string, handler: Handler) {
			harness.handlers.set(name, [
				...(harness.handlers.get(name) ?? []),
				handler,
			]);
		},
		close() {
			if (harness.pswp.opener.isOpening) return;
			for (const handler of harness.handlers.get("close") ?? []) handler();
		},
		refreshSlideContent(index: number) {
			harness.refreshedIndex = index;
		},
		goTo(index: number) {
			harness.goToIndex = index;
			harness.pswp.currIndex = index;
		},
		updateSize() {},
		ui: {
			registerElement(element: typeof harness.registered) {
				harness.registered = element;
			},
		},
	},
}));

vi.mock("photoswipe/lightbox", () => ({
	default: class PhotoSwipeLightboxMock {
		pswp = harness.pswp;

		constructor(options: Record<string, unknown>) {
			harness.options = options;
		}

		addFilter(name: string, filter: Filter) {
			harness.filters.set(name, filter);
		}

		on(name: string, handler: Handler) {
			harness.handlers.set(name, [
				...(harness.handlers.get(name) ?? []),
				handler,
			]);
		}

		init() {
			harness.initCount += 1;
			for (const handler of harness.handlers.get("uiRegister") ?? []) handler();
		}

		loadAndOpen(index: number) {
			harness.loadedIndex = index;
			harness.pswp.currIndex = index;
			for (const handler of harness.handlers.get("beforeOpen") ?? []) handler();
		}

		destroy() {
			for (const handler of harness.handlers.get("destroy") ?? []) handler();
		}
	},
}));

const items = [
	{ id: "image", kind: "image" as const, url: "media://image" },
	{ id: "video", kind: "video" as const, url: "media://video" },
	{
		id: "missing",
		kind: "image" as const,
		url: null,
		unavailableLabel: "Cached copy no longer stored",
	},
];

describe("MixedMediaViewer", () => {
	beforeEach(() => {
		harness.handlers.clear();
		harness.filters.clear();
		harness.loadedIndex = -1;
		harness.options = null;
		harness.refreshedIndex = -1;
		harness.registered = null;
		harness.initCount = 0;
		harness.goToIndex = -1;
		harness.pswp.currIndex = 0;
		harness.pswp.opener.isOpening = false;
		reportViewerDiagnosticMock.mockReset();
		expect(backLayerManager.size).toBe(0);
	});

	afterEach(() => cleanup());

	it("opens the requested item while preserving mixed-media order and position", async () => {
		const onClose = vi.fn();
		render(MixedMediaViewer, { items, startIndex: 1, onClose });
		await waitFor(() => expect(harness.loadedIndex).toBe(1));

		expect(harness.filters.get("numItems")?.()).toBe(3);
		expect(harness.options).toMatchObject({
			close: true,
			closeTitle: "Close media viewer",
			counter: false,
			loop: false,
		});
		const itemData = harness.filters.get("itemData") as unknown as (
			item: unknown,
			index: number,
		) => unknown;
		expect(itemData({}, 0)).toMatchObject({
			src: "media://image",
			width: expect.any(Number),
			height: expect.any(Number),
		});
		expect(itemData({}, 0)).not.toMatchObject({ width: 1, height: 1 });
		expect(itemData({}, 2)).toMatchObject({
			html: expect.stringContaining("Cached copy no longer stored"),
		});

		const indicator = document.createElement("div");
		harness.registered?.onInit(indicator, harness.pswp);
		expect(harness.registered?.name).toBe("shared-media-position");
		expect(indicator.textContent).toBe("2 / 3");
		expect(indicator.getAttribute("role")).toBe("status");
		expect(indicator.getAttribute("aria-live")).toBe("polite");
		expect(indicator.getAttribute("aria-atomic")).toBe("true");
		harness.pswp.currIndex = 2;
		for (const handler of harness.handlers.get("change") ?? []) handler();
		expect(indicator.textContent).toBe("3 / 3");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("preserves supplied media dimensions", async () => {
		render(MixedMediaViewer, {
			items: [
				{
					id: "sized-image",
					kind: "image",
					url: "media://sized-image",
					width: 1600,
					height: 900,
				},
			],
			startIndex: 0,
			onClose: vi.fn(),
		});
		await waitFor(() => expect(harness.loadedIndex).toBe(0));

		const itemData = harness.filters.get("itemData") as unknown as (
			item: unknown,
			index: number,
		) => unknown;
		expect(itemData({}, 0)).toMatchObject({ width: 1600, height: 900 });
	});

	it("updates a mutable deck without recreating PhotoSwipe and preserves active identity", async () => {
		const view = render(MixedMediaViewer, {
			items: items.slice(0, 2),
			startIndex: 1,
			onClose: vi.fn(),
		});
		await waitFor(() => expect(harness.loadedIndex).toBe(1));
		harness.pswp.currIndex = 1;

		await view.rerender({
			items: [items[2]!, ...items.slice(0, 2)],
			startIndex: 2,
			onClose: vi.fn(),
		});

		expect(harness.initCount).toBe(1);
		expect(harness.filters.get("numItems")?.()).toBe(3);
		expect(harness.goToIndex).toBe(2);
	});

	it("advances the coordinator through opening and open phases", async () => {
		const onOpening = vi.fn();
		const onOpened = vi.fn();
		render(MixedMediaViewer, {
			items,
			startIndex: 0,
			onClose: vi.fn(),
			onOpening,
			onOpened,
		});
		await waitFor(() => expect(harness.loadedIndex).toBe(0));
		expect(onOpening).toHaveBeenCalledOnce();
		expect(onOpened).not.toHaveBeenCalled();

		for (const handler of harness.handlers.get("afterInit") ?? []) handler();
		expect(onOpened).toHaveBeenCalledOnce();
		expect(harness.pswp.element.getAttribute("role")).toBe("dialog");
		expect(harness.pswp.element.getAttribute("aria-modal")).toBe("true");
		expect(harness.pswp.element.getAttribute("aria-label")).toBe(
			"Media viewer",
		);
	});

	it("reports distinct open, load, failure, close, and destroy stages", async () => {
		const view = render(MixedMediaViewer, {
			items,
			startIndex: 0,
			onClose: vi.fn(),
		});
		await waitFor(() => expect(harness.loadedIndex).toBe(0));

		for (const handler of harness.handlers.get("afterInit") ?? []) handler();
		for (const handler of harness.handlers.get("loadComplete") ?? [])
			handler({ content: { index: 0 }, isError: false });
		for (const handler of harness.handlers.get("loadError") ?? [])
			handler({ content: { index: 0 } });
		for (const handler of harness.handlers.get("close") ?? []) handler();
		view.unmount();

		expect(
			reportViewerDiagnosticMock.mock.calls.map(([value]) => value.event),
		).toEqual(
			expect.arrayContaining([
				"open_requested",
				"opened",
				"item_loaded",
				"item_failed",
				"closed",
				"destroyed",
			]),
		);
		for (const [diagnostic] of reportViewerDiagnosticMock.mock.calls) {
			expect(Object.keys(diagnostic).sort()).toEqual([
				"access",
				"cacheSource",
				"countBucket",
				"event",
				"failure",
				"latencyBucket",
				"mediaKind",
				"positionBucket",
				"surface",
			]);
		}
	});

	it("replaces an opaque load failure with a bounded retry action", async () => {
		render(MixedMediaViewer, { items, startIndex: 0, onClose: vi.fn() });
		await waitFor(() => expect(harness.loadedIndex).toBe(0));

		const contentErrorElement = harness.filters.get(
			"contentErrorElement",
		) as unknown as (
			element: HTMLElement,
			content: { index: number },
		) => HTMLElement;
		const replacement = contentErrorElement(document.createElement("div"), {
			index: 1,
		});
		const retry = replacement.querySelector("button");
		expect(replacement.getAttribute("role")).toBe("alert");
		expect(replacement.textContent).toContain("Media could not be loaded");
		expect(retry?.textContent).toBe("Try again");
		retry?.click();
		expect(harness.refreshedIndex).toBe(1);
	});

	it("handles viewer dismissal before its parent and restores opener focus", async () => {
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		const focus = vi.spyOn(opener, "focus");
		const onClose = vi.fn();
		render(MixedMediaViewer, { items, startIndex: 0, opener, onClose });
		await waitFor(() => expect(backLayerManager.size).toBe(1));
		const drawerBack = vi.fn(() => "handled" as const);
		const releaseDrawer = backLayerManager.register({
			priority: "drawer",
			handler: drawerBack,
		});

		await expect(backLayerManager.handleBack()).resolves.toBe("handled");
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(drawerBack).not.toHaveBeenCalled();
		await waitFor(() => expect(focus).toHaveBeenCalledOnce());
		expect(backLayerManager.size).toBe(1);
		releaseDrawer();
		expect(backLayerManager.size).toBe(0);
		opener.remove();
	});

	it("closes on Escape", async () => {
		const onClose = vi.fn();
		render(MixedMediaViewer, { items, startIndex: 0, onClose });
		await waitFor(() => expect(harness.loadedIndex).toBe(0));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("honors one dismissal requested during the opening animation", async () => {
		const onClose = vi.fn();
		harness.pswp.opener.isOpening = true;
		render(MixedMediaViewer, { items, startIndex: 0, onClose });
		await waitFor(() => expect(harness.loadedIndex).toBe(0));

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onClose).not.toHaveBeenCalled();
		harness.pswp.opener.isOpening = false;
		for (const handler of harness.handlers.get("openingAnimationEnd") ?? [])
			handler();
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("pauses and clears owned video sources on teardown", async () => {
		const pause = vi
			.spyOn(HTMLMediaElement.prototype, "pause")
			.mockImplementation(() => {});
		const load = vi
			.spyOn(HTMLMediaElement.prototype, "load")
			.mockImplementation(() => {});
		const onClose = vi.fn();
		const view = render(MixedMediaViewer, { items, startIndex: 1, onClose });
		await waitFor(() => expect(harness.loadedIndex).toBe(1));

		const content = {
			index: 1,
			element: null as HTMLElement | null,
			state: "idle",
			onLoaded: vi.fn(),
			onError: vi.fn(),
		};
		const preventDefault = vi.fn();
		for (const handler of harness.handlers.get("contentLoad") ?? [])
			handler({ content, preventDefault });
		const video = content.element?.querySelector("video");
		expect(video?.getAttribute("src")).toBe("media://video");
		for (const handler of harness.handlers.get("contentRemove") ?? [])
			handler({ content });
		for (const handler of harness.handlers.get("contentDestroy") ?? [])
			handler({ content });
		expect(pause).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(1);

		view.unmount();
		expect(pause).toHaveBeenCalledTimes(1);
		expect(video?.hasAttribute("src")).toBe(false);
		expect(load).toHaveBeenCalledTimes(1);
	});
});
