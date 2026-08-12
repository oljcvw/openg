// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerHarness = vi.hoisted(() => ({
	session: null as null | {
		items: Array<{
			id: string;
			kind: "image" | "video";
			url: string | null;
			width?: number;
			height?: number;
		}>;
		preload?: [number, number];
		onItemActivate?: ((item: unknown, index: number) => void) | null;
	},
	openExplicit: vi.fn(),
}));

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$lib/chat/conversation-media-viewer.svelte", () => ({
	getConversationMediaViewer: () => () => viewerHarness,
}));
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
				processing: true,
				rejectionId: null,
			},
		],
	}),
	recordAlbumContentView: vi.fn(() => Promise.resolve()),
}));
vi.mock("$lib/app-data/album-cache", () => ({
	discoverSharedAlbum: vi.fn().mockResolvedValue(undefined),
	markAlbumUnavailable: vi.fn(),
	readCachedAlbum: vi.fn().mockResolvedValue(null),
	resolveCachedAlbum: vi.fn(),
	retainViewedAlbumContent: vi.fn(() => Promise.resolve()),
	subscribeCachedAlbum: vi.fn(() => vi.fn()),
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({
		albumPreloadConcurrency: 2,
		albumPreloadTimeoutMs: 12_345,
	}),
	getKeepUnavailableCachedAlbumsSnapshot: () => false,
	subscribePreferences: () => vi.fn(),
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

import AlbumMessage from "./AlbumMessage.svelte";

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

const renderAlbum = (
	overrides: Partial<typeof message> = {},
	props: {
		senderProfileId?: number;
		peerProfileId?: number;
		isOut?: boolean;
	} = {},
) =>
	render(AlbumMessage, {
		message: { ...message, ...overrides },
		messageId: "album-message",
		...props,
	});

describe("AlbumMessage conversation viewer session", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		viewerHarness.session = null;
		viewerHarness.openExplicit.mockImplementation(
			async ({
				resolve,
			}: {
				resolve: (signal: AbortSignal) => Promise<unknown>;
			}) => {
				viewerHarness.session = (await resolve(
					new AbortController().signal,
				)) as typeof viewerHarness.session;
				return true;
			},
		);
	});

	afterEach(cleanup);

	it("only treats the album owner as proven for an incoming active-peer message", async () => {
		const { discoverSharedAlbum } = await import("$lib/app-data/album-cache");
		renderAlbum({}, { senderProfileId: 42, peerProfileId: 42, isOut: false });

		await waitFor(() =>
			expect(discoverSharedAlbum).toHaveBeenCalledWith(
				expect.objectContaining({ ownerProfileId: 42, ownerValidated: true }),
			),
		);
	});

	it("does not prove album ownership from an outgoing sender", async () => {
		const { discoverSharedAlbum } = await import("$lib/app-data/album-cache");
		renderAlbum({}, { senderProfileId: 42, peerProfileId: 42, isOut: true });

		await waitFor(() => expect(discoverSharedAlbum).toHaveBeenCalledOnce());
		expect(discoverSharedAlbum).toHaveBeenCalledWith(
			expect.objectContaining({ ownerValidated: false }),
		);
	});

	it("preserves once-view order without speculative preload or view recording", async () => {
		const { preloadAlbumSlides } = await import("./album-media-preload");
		const { recordAlbumContentView } =
			await import("$lib/api/messaging/albums");
		const view = renderAlbum({ expirationType: "ONCE" });

		expect(viewerHarness.openExplicit).not.toHaveBeenCalled();
		expect(recordAlbumContentView).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole("button"));
		await waitFor(() => expect(viewerHarness.session).not.toBeNull());

		expect(preloadAlbumSlides).not.toHaveBeenCalled();
		expect(viewerHarness.openExplicit).toHaveBeenCalledWith(
			expect.objectContaining({ messageId: "album-message" }),
		);
		expect(viewerHarness.session?.preload).toEqual([0, 0]);
		expect(viewerHarness.session?.items).toMatchObject([
			{ id: "1", kind: "image", url: "https://example.test/1.jpg" },
			{ id: "2", kind: "video", url: "https://example.test/2.mp4" },
			{ id: "3", kind: "image", url: null },
		]);
		expect(recordAlbumContentView).not.toHaveBeenCalled();
		viewerHarness.session?.onItemActivate?.(viewerHarness.session.items[2], 2);
		expect(recordAlbumContentView).not.toHaveBeenCalled();
		viewerHarness.session?.onItemActivate?.(viewerHarness.session.items[0], 0);
		await waitFor(() => expect(recordAlbumContentView).toHaveBeenCalledOnce());
	});

	it("passes measured mixed media to the conversation viewer", async () => {
		const { preloadAlbumSlides } = await import("./album-media-preload");
		const view = renderAlbum();

		await fireEvent.click(view.getByRole("button"));
		await waitFor(() => expect(viewerHarness.session).not.toBeNull());

		expect(preloadAlbumSlides).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				concurrency: 2,
				timeoutMs: 12_345,
				signal: expect.any(AbortSignal),
			}),
		);
		expect(viewerHarness.session?.preload).toEqual([1, 2]);
		expect(viewerHarness.session?.items[0]).toMatchObject({
			width: 1080,
			height: 1920,
		});
	});

	it("refetches a remote album for each explicit viewer session", async () => {
		const { getAlbumContent } = await import("$lib/api/messaging/albums");
		const view = renderAlbum();

		await fireEvent.click(view.getByRole("button"));
		await waitFor(() => expect(getAlbumContent).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
				false,
			),
		);
		await fireEvent.click(view.getByRole("button"));
		await waitFor(() => expect(getAlbumContent).toHaveBeenCalledTimes(2));
	});
});
