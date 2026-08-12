import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureShortVideoMock, getMediaCaptureAvailabilityMock } = vi.hoisted(
	() => ({
		captureShortVideoMock: vi.fn(),
		getMediaCaptureAvailabilityMock: vi.fn(),
	}),
);

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
	getMediaCaptureAvailability: getMediaCaptureAvailabilityMock,
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
		getMediaCaptureAvailabilityMock.mockResolvedValue({
			available: true,
			reason: null,
		});
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
		await fireEvent.click(
			await screen.findByRole("button", { name: "Short video" }),
		);

		const reviewButton = await screen.findByRole("button", {
			name: "Review video below",
		});
		expect(reviewButton.hasAttribute("disabled")).toBe(true);
		expect(captureShortVideoMock).toHaveBeenCalledOnce();
	});

	it("hides native capture actions when the capability is unavailable", async () => {
		getMediaCaptureAvailabilityMock.mockResolvedValue({
			available: false,
			reason: "unsupported-platform",
		});

		render(Harness);

		expect(
			await screen.findByText("Camera capture isn't available on this device."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Short video" })).toBeNull();
	});
});
