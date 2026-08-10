// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AlbumMediaDrawer from "./AlbumMediaDrawer.svelte";

afterEach(async () => {
	cleanup();
	// Bits UI intentionally defers body-scroll-lock restoration for one frame
	// so a replacement overlay can acquire the lock without flicker. Drain that
	// bounded cleanup before Vitest disposes this test's jsdom document.
	await new Promise((resolve) => setTimeout(resolve, 30));
});

describe("AlbumMediaDrawer", () => {
	it("renders separate semantic media controls and opens the selected item", async () => {
		const onOpenItem = vi.fn();
		const album = {
			albumId: 5,
			albumName: "Shared",
			profileId: 42,
			albumViewable: true,
			hasUnseenContent: false,
			sharedCount: 1,
			createdAt: "2026-08-01T12:00:00",
			updatedAt: "2026-08-01T12:00:00",
			content: [
				{
					contentId: 1,
					contentType: "image/jpeg",
					coverUrl: null,
					statusId: 1,
					thumbUrl: "https://example.com/one.jpg",
					url: "https://example.com/one-full.jpg",
					processing: false,
					rejectionId: null,
				},
				{
					contentId: 2,
					contentType: "video/mp4",
					coverUrl: "https://example.com/two.jpg",
					statusId: 1,
					thumbUrl: "https://example.com/two.jpg",
					url: "https://example.com/two.mp4",
					processing: false,
					rejectionId: null,
				},
			],
		};
		const view = render(AlbumMediaDrawer, {
			open: true,
			album,
			onOpenItem,
		});

		await fireEvent.click(
			view.getByRole("button", { name: "Open album item 2 of 2" }),
		);
		expect(onOpenItem).toHaveBeenCalledExactlyOnceWith(1, expect.anything());
	});
});
