// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
	captureScrollAnchor,
	captureScrollNeighborhood,
	restoreScrollAnchor,
} from "$lib/navigation/navigation-memory";

function rect(top: number, bottom: number): DOMRect {
	return {
		top,
		bottom,
		left: 0,
		right: 100,
		width: 100,
		height: bottom - top,
		x: 0,
		y: top,
		toJSON: () => ({}),
	};
}

describe("scroll anchor DOM seam", () => {
	it("captures the stable key and offset of the first visible rendered item", () => {
		const container = document.createElement("div");
		container.scrollTop = 320;
		container.getBoundingClientRect = () => rect(100, 500);
		const hidden = document.createElement("div");
		hidden.dataset.navigationItemKey = "profile:1";
		hidden.getBoundingClientRect = () => rect(20, 90);
		const visible = document.createElement("div");
		visible.dataset.navigationItemKey = "profile:2";
		visible.getBoundingClientRect = () => rect(80, 160);
		container.append(hidden, visible);

		expect(captureScrollAnchor(container, 5678)).toEqual({
			itemKey: "profile:2",
			offsetPx: -20,
			fallbackOffsetPx: 320,
			capturedAt: 5678,
		});
		expect(captureScrollNeighborhood(container, "profile:2")).toEqual({
			orderedItemKeys: ["profile:1", "profile:2"],
			anchorIndex: 1,
		});
	});

	it("restores an exact item after render and uses raw fallback without items", () => {
		const container = document.createElement("div");
		container.getBoundingClientRect = () => rect(100, 500);
		const visible = document.createElement("div");
		visible.dataset.navigationItemKey = "profile:2";
		visible.getBoundingClientRect = () => rect(250, 330);
		container.append(visible);

		const exact = restoreScrollAnchor(container, {
			itemKey: "profile:2",
			offsetPx: -20,
			fallbackOffsetPx: 480,
			capturedAt: 5678,
		});
		expect(exact).toEqual({ itemKey: "profile:2", scrollTop: 170 });
		expect(container.scrollTop).toBe(170);

		visible.remove();
		const fallback = restoreScrollAnchor(container, {
			itemKey: "missing",
			offsetPx: 0,
			fallbackOffsetPx: 480,
			capturedAt: 5678,
		});
		expect(fallback).toEqual({ itemKey: null, scrollTop: 480 });
		expect(container.scrollTop).toBe(480);
	});

	it("supports transcript message IDs without adding retained DOM", () => {
		const container = document.createElement("div");
		container.scrollTop = 90;
		container.getBoundingClientRect = () => rect(0, 400);
		const message = document.createElement("div");
		message.dataset.messageId = "message-7";
		message.getBoundingClientRect = () => rect(25, 75);
		container.append(message);

		expect(
			captureScrollAnchor(
				container,
				999,
				"[data-message-id]",
				"data-message-id",
			),
		).toMatchObject({
			itemKey: "message-7",
			offsetPx: 25,
			fallbackOffsetPx: 90,
		});
	});
});
