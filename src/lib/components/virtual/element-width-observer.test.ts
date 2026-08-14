import { afterEach, describe, expect, it, vi } from "vitest";

import { observeElementWidth } from "./element-width-observer";

describe("observeElementWidth", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("rounds, coalesces, deduplicates, and cancels pending delivery", () => {
		let callback: ResizeObserverCallback = () => {};
		const disconnect = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(next: ResizeObserverCallback) {
					callback = next;
				}
				observe() {}
				disconnect() {
					disconnect();
				}
			},
		);
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
			frames.set(++nextFrame, next);
			return nextFrame;
		});
		const cancel = vi.fn((id: number) => frames.delete(id));
		vi.stubGlobal("cancelAnimationFrame", cancel);
		let width = 100.4;
		const node = document.createElement("div");
		vi.spyOn(node, "getBoundingClientRect").mockImplementation(
			() => ({ width }) as DOMRect,
		);
		const widths: number[] = [];
		const ownership = observeElementWidth(node, (value) => widths.push(value));

		expect(widths).toEqual([100]);
		callback([], {} as ResizeObserver);
		callback([], {} as ResizeObserver);
		expect(frames).toHaveLength(1);
		frames.get(1)?.(0);
		expect(widths).toEqual([100]);
		width = 101.6;
		callback([], {} as ResizeObserver);
		ownership.destroy();

		expect(cancel).toHaveBeenCalledWith(2);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(widths).toEqual([100]);
	});
});
