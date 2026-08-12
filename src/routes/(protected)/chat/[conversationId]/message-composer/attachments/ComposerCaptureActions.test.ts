import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureShortVideoMock } = vi.hoisted(() => ({
	captureShortVideoMock: vi.fn(),
}));

vi.mock("$lib/api/messaging/chat-media", () => ({
	addCapturedPhotoToDrawer: vi.fn(),
	uploadExpiringChatVideo: vi.fn(),
}));
vi.mock("$lib/api/messaging/expiring-videos", () => ({
	getExpiringVideoStatus: vi.fn().mockResolvedValue({ available: 1 }),
}));
vi.mock("$lib/api/messaging/messages", () => ({
	sendExpiringVideoMessage: vi.fn(),
}));
vi.mock("$lib/app-data/media-capture", () => ({
	capturePhoto: vi.fn(),
	captureShortVideo: captureShortVideoMock,
	deleteCapturedShortVideo: vi.fn().mockResolvedValue(undefined),
	reportMediaWorkflowDiagnostic: vi.fn(),
}));
vi.mock("$lib/app-data/short-video-cache", () => ({
	cacheShortVideo: vi.fn(),
}));

import Harness from "./ComposerCaptureActions.test.svelte";

describe("ComposerCaptureActions pending review", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		captureShortVideoMock.mockResolvedValue({
			status: "ready",
			dataBase64: "AA==",
			contentType: "video/mp4",
			durationMs: 1_000,
			fileCacheKey: "capture-token",
			byteLength: 1,
			width: 100,
			height: 100,
			hasAudio: true,
		});
	});

	afterEach(cleanup);

	it("blocks another recording while a captured video awaits review", async () => {
		render(Harness);
		await fireEvent.click(screen.getByRole("button", { name: "Short video" }));

		const reviewButton = await screen.findByRole("button", {
			name: "Review video below",
		});
		expect(reviewButton.hasAttribute("disabled")).toBe(true);
		expect(captureShortVideoMock).toHaveBeenCalledOnce();
	});
});
