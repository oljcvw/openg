// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfileItem from "./ProfileItem.svelte";

const navigation = vi.hoisted(() => ({ openAppDetail: vi.fn() }));

vi.mock("$lib/navigation/app-navigation", async (importOriginal) => ({
	...(await importOriginal()),
	openAppDetail: navigation.openAppDetail,
}));

afterEach(cleanup);
beforeEach(() => navigation.openAppDetail.mockReset());

describe("ProfileItem app navigation", () => {
	it("routes ordinary avatar and row clicks through openAppDetail", async () => {
		const view = render(ProfileItem, {
			avatar: { link: "/profile/42", mediaHash: null },
			link: "/chat/7",
			title: { value: "Someone" },
		});
		const links = view.getAllByRole("link");

		await fireEvent.click(links[0]);
		await fireEvent.click(links[1]);

		expect(navigation.openAppDetail).toHaveBeenNthCalledWith(1, "/profile/42");
		expect(navigation.openAppDetail).toHaveBeenNthCalledWith(2, "/chat/7");
	});

	it("lets a collection own row navigation without changing the avatar destination", async () => {
		const openRow = vi.fn();
		const view = render(ProfileItem, {
			avatar: { link: "/profile/42", mediaHash: null },
			link: "/chat/7",
			onNavigate: openRow,
			title: { value: "Someone" },
		});
		const links = view.getAllByRole("link");

		await fireEvent.click(links[0]);
		await fireEvent.click(links[1]);

		expect(navigation.openAppDetail).toHaveBeenCalledExactlyOnceWith(
			"/profile/42",
		);
		expect(openRow).toHaveBeenCalledExactlyOnceWith("/chat/7");
	});

	it("leaves a modified row click native", () => {
		const view = render(ProfileItem, {
			avatar: { link: "/profile/42", mediaHash: null },
			link: "/chat/7",
			title: { value: "Someone" },
		});
		const row = view.getAllByRole("link")[1];
		let preventedAtDocument = true;
		document.addEventListener(
			"click",
			(event) => {
				preventedAtDocument = event.defaultPrevented;
				event.preventDefault();
			},
			{ once: true },
		);

		row.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				metaKey: true,
			}),
		);

		expect(preventedAtDocument).toBe(false);
		expect(navigation.openAppDetail).not.toHaveBeenCalled();
	});

	it("marks the active row destination, but not its profile link, as current", () => {
		const view = render(ProfileItem, {
			active: true,
			ariaCurrent: "page",
			avatar: { link: "/profile/42", mediaHash: null },
			link: "/chat/7",
			title: { value: "Someone" },
		});

		const links = view.getAllByRole("link");
		expect(links[0].getAttribute("aria-current")).toBeNull();
		expect(links[1].getAttribute("aria-current")).toBe("page");
		expect(links[2].getAttribute("aria-current")).toBe("page");
	});

	it("exposes the requested Inbox density without clipping the row", () => {
		const view = render(ProfileItem, {
			avatar: { mediaHash: null },
			density: "compact",
			link: "/chat/7",
			title: { value: "Someone" },
		});

		const row = view.container.querySelector<HTMLElement>("[data-slot='item']");
		expect(row?.dataset.density).toBe("compact");
		expect(row?.style.minBlockSize).toBe("5rem");
		expect(row?.style.blockSize).toBe("");
	});
});
