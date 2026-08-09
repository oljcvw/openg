// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backLayerManager } from "$lib/navigation/app-navigation";
import MixedMediaViewer from "./MixedMediaViewer.svelte";

type Handler = (event?: unknown) => void;
type Filter = (...args: never[]) => unknown;
type TestPswp = {
	currIndex: number;
	getNumItems: () => number;
	on: (name: string, handler: Handler) => void;
	close: () => void;
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
	registered: null as RegisteredElement | null,
	pswp: {
		currIndex: 0,
		getNumItems: () => 3,
		on(name: string, handler: Handler) {
			harness.handlers.set(name, [
				...(harness.handlers.get(name) ?? []),
				handler,
			]);
		},
		close() {
			for (const handler of harness.handlers.get("close") ?? []) handler();
		},
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
		harness.registered = null;
		harness.pswp.currIndex = 0;
		expect(backLayerManager.size).toBe(0);
	});

	afterEach(() => cleanup());

	it("opens the requested item while preserving mixed-media order and position", async () => {
		const onClose = vi.fn();
		render(MixedMediaViewer, { items, startIndex: 1, onClose });
		await waitFor(() => expect(harness.loadedIndex).toBe(1));

		expect(harness.filters.get("numItems")?.()).toBe(3);
		const itemData = harness.filters.get("itemData") as unknown as (
			item: unknown,
			index: number,
		) => unknown;
		expect(itemData({}, 0)).toMatchObject({
			src: "media://image",
		});
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
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		expect(focus).toHaveBeenCalledOnce();
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
