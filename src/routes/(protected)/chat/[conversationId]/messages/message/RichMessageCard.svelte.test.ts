// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Harness from "./RichMessageCard.test-harness.svelte";

const navigation = vi.hoisted(() => ({ replaceAppDetail: vi.fn() }));

vi.mock("$lib/navigation/app-navigation", async (importOriginal) => ({
	...(await importOriginal()),
	replaceAppDetail: navigation.replaceAppDetail,
}));

afterEach(cleanup);
beforeEach(() => navigation.replaceAppDetail.mockReset());

describe("RichMessageCard app navigation", () => {
	it("routes an ordinary card click through replaceAppDetail", async () => {
		const view = render(Harness, { href: "/albums/11?owner=42" });

		await fireEvent.click(view.getByRole("link"));

		expect(navigation.replaceAppDetail).toHaveBeenCalledOnce();
		expect(navigation.replaceAppDetail).toHaveBeenCalledWith(
			"/albums/11?owner=42",
		);
	});

	it("leaves a modified card click native", () => {
		const view = render(Harness, { href: "/albums/11?owner=42" });
		let preventedAtDocument = true;
		document.addEventListener(
			"click",
			(event) => {
				preventedAtDocument = event.defaultPrevented;
				event.preventDefault();
			},
			{ once: true },
		);

		view.getByRole("link").dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				ctrlKey: true,
			}),
		);

		expect(preventedAtDocument).toBe(false);
		expect(navigation.replaceAppDetail).not.toHaveBeenCalled();
	});
});
