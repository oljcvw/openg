// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
<<<<<<< HEAD
import { afterEach, describe, expect, it, vi } from "vitest";
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
>>>>>>> origin/forgejo-sync

import ScrollToTopButton from "./ScrollToTopButton.svelte";

const SCREEN_HEIGHT = 800;
<<<<<<< HEAD
=======
const GLIDE_MS = 400;
>>>>>>> origin/forgejo-sync

async function settle() {
	await tick();
	await tick();
}

async function mountWithScroller({ scrollTop = 0 } = {}) {
	const scroller = document.createElement("div");
	Object.defineProperty(scroller, "clientHeight", {
		value: SCREEN_HEIGHT,
		configurable: true,
	});
	Object.defineProperty(scroller, "scrollHeight", {
		value: 20_000,
		configurable: true,
	});
<<<<<<< HEAD
	const scroll = vi.fn();
	scroller.scroll = scroll;
=======
>>>>>>> origin/forgejo-sync
	scroller.scrollTop = scrollTop;
	document.body.append(scroller);

	const view = render(ScrollToTopButton, { props: { container: scroller } });
	await settle();

	const button = () =>
		view.container.querySelector<HTMLElement>(
			'[aria-label="Scroll to top"]',
		);
	return {
		scroller,
<<<<<<< HEAD
		scroll,
=======
>>>>>>> origin/forgejo-sync
		button,
		async scrollTo(top: number) {
			scroller.scrollTop = top;
			scroller.dispatchEvent(new Event("scroll"));
			await settle();
		},
		async dispatch(type: string) {
			scroller.dispatchEvent(new Event(type));
			await settle();
		},
		async click() {
			button()?.click();
			await settle();
		},
<<<<<<< HEAD
=======
		async glideFor(ms: number) {
			vi.advanceTimersByTime(ms);
			await settle();
		},
>>>>>>> origin/forgejo-sync
	};
}

describe("the scroll-to-top button", () => {
<<<<<<< HEAD
	afterEach(() => {
		cleanup();
		document.body.replaceChildren();
=======
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: [
				"requestAnimationFrame",
				"cancelAnimationFrame",
				"performance",
			],
		});
	});

	afterEach(() => {
		cleanup();
		document.body.replaceChildren();
		vi.useRealTimers();
>>>>>>> origin/forgejo-sync
	});

	it("appears once the scroller leaves the top and hides on the way back", async () => {
		const view = await mountWithScroller();
		expect(view.button()).toBeNull();

		await view.scrollTo(16);
		expect(view.button()).toBeNull();

		await view.scrollTo(17);
		expect(view.button()).not.toBeNull();

		await view.scrollTo(16);
		expect(view.button()).toBeNull();
	});

	it("appears straight away on a scroller that is handed over already scrolled", async () => {
		const view = await mountWithScroller({ scrollTop: 5000 });

		expect(view.button()).not.toBeNull();
	});

	it("flies in instead of popping", async () => {
		const animate = vi.spyOn(Element.prototype, "animate");
		const view = await mountWithScroller();

		await view.scrollTo(400);

		expect(view.button()).not.toBeNull();
		expect(animate).toHaveBeenCalled();
		animate.mockRestore();
	});

	it("jumps to within one screen of the top before gliding the rest", async () => {
		const view = await mountWithScroller();
		await view.scrollTo(5000);

		await view.click();
<<<<<<< HEAD

		expect(view.scroller.scrollTop).toBe(SCREEN_HEIGHT);
		expect(view.scroll).toHaveBeenCalledWith({
			top: 0,
			behavior: "smooth",
		});
		expect(view.button()).toBeNull();
=======
		expect(view.scroller.scrollTop).toBe(SCREEN_HEIGHT);
		expect(view.button()).toBeNull();

		await view.glideFor(GLIDE_MS);
		expect(view.scroller.scrollTop).toBe(0);
>>>>>>> origin/forgejo-sync
	});

	it("glides without a jump when the top is less than a screen away", async () => {
		const view = await mountWithScroller();
		await view.scrollTo(500);

		await view.click();
<<<<<<< HEAD

		expect(view.scroller.scrollTop).toBe(500);
		expect(view.scroll).toHaveBeenCalledWith({
			top: 0,
			behavior: "smooth",
		});
=======
		expect(view.scroller.scrollTop).toBe(500);

		await view.glideFor(GLIDE_MS);
		expect(view.scroller.scrollTop).toBe(0);
	});

	it("starts the glide fast and slows into the top", async () => {
		const view = await mountWithScroller();
		await view.scrollTo(SCREEN_HEIGHT);

		await view.click();
		await view.glideFor(GLIDE_MS / 4);
		const firstQuarter = SCREEN_HEIGHT - view.scroller.scrollTop;
		await view.glideFor(GLIDE_MS / 2);
		const lastQuarterStart = view.scroller.scrollTop;
		await view.glideFor(GLIDE_MS / 4);

		expect(firstQuarter).toBeGreaterThan(SCREEN_HEIGHT / 3);
		expect(lastQuarterStart).toBeLessThan(SCREEN_HEIGHT / 30);
		expect(view.scroller.scrollTop).toBe(0);
>>>>>>> origin/forgejo-sync
	});

	for (const takeover of ["wheel", "touchstart"]) {
		it(`stays hidden while the glide runs and returns on ${takeover}`, async () => {
			const view = await mountWithScroller();
			await view.scrollTo(5000);
			await view.click();

			await view.scrollTo(400);
			expect(view.button()).toBeNull();

			await view.dispatch(takeover);
			await view.scrollTo(400);
			expect(view.button()).not.toBeNull();
		});
	}

	it("tracks the scroller again once a glide lands", async () => {
		const view = await mountWithScroller();
		await view.scrollTo(5000);
		await view.click();

<<<<<<< HEAD
		await view.scrollTo(0);
=======
		await view.glideFor(GLIDE_MS);
>>>>>>> origin/forgejo-sync
		await view.scrollTo(400);

		expect(view.button()).not.toBeNull();
	});

<<<<<<< HEAD
	it("releases the button on the scroll end of an interrupted glide", async () => {
=======
	it("ignores the scroll events its own glide causes", async () => {
>>>>>>> origin/forgejo-sync
		const view = await mountWithScroller();
		await view.scrollTo(5000);
		await view.click();

<<<<<<< HEAD
		view.scroller.scrollTop = 400;
		await view.dispatch("scrollend");

		expect(view.button()).not.toBeNull();
	});

	it("releases the button when a glide never lands", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const view = await mountWithScroller();
			await view.scrollTo(5000);
			await view.click();

			vi.advanceTimersByTime(1500);
			await settle();

			expect(view.button()).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
=======
		await view.glideFor(GLIDE_MS / 2);
		await view.dispatch("scroll");
		await view.dispatch("scrollend");

		expect(view.button()).toBeNull();
		await view.glideFor(GLIDE_MS / 2);
		expect(view.scroller.scrollTop).toBe(0);
>>>>>>> origin/forgejo-sync
	});
});
