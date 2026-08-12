import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, reportClientDiagnosticMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	reportClientDiagnosticMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportClientDiagnostic: reportClientDiagnosticMock,
}));

import {
	capturePhoto,
	captureShortVideo,
	getMediaCaptureAvailability,
	reportMediaWorkflowDiagnostic,
} from "$lib/app-data/media-capture";

describe("native media capture bridge", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		reportClientDiagnosticMock.mockReset();
	});

	it("validates a bounded JPEG photo result", async () => {
		invokeMock.mockResolvedValue({
			status: "ready",
			dataBase64: "AQID",
			contentType: "image/jpeg",
			byteLength: 3,
			width: 1_024,
			height: 768,
		});

		await expect(capturePhoto()).resolves.toMatchObject({ status: "ready" });
		expect(invokeMock).toHaveBeenCalledWith("media_capture_photo");
	});

	it("uses native capability availability instead of platform identity", async () => {
		invokeMock.mockResolvedValue({
			available: true,
			reason: null,
		});

		await expect(getMediaCaptureAvailability()).resolves.toEqual({
			available: true,
			reason: null,
		});
		expect(invokeMock).toHaveBeenCalledWith("media_capture_availability");
	});

	it("passes the fixed protocol duration limit to video capture", async () => {
		invokeMock.mockRejectedValue("cancelled");

		await expect(captureShortVideo()).resolves.toEqual({ status: "cancelled" });
		expect(invokeMock).toHaveBeenCalledWith("media_capture_short_video");
	});

	it("normalizes an Error-shaped native photo cancellation", async () => {
		invokeMock.mockRejectedValue(new Error("cancelled"));

		await expect(capturePhoto()).resolves.toEqual({ status: "cancelled" });
		expect(invokeMock).toHaveBeenCalledWith("media_capture_photo");
	});

	it("rejects a video result beyond the protocol limit", async () => {
		invokeMock.mockResolvedValue({
			status: "ready",
			dataBase64: "AQID",
			contentType: "video/mp4",
			durationMs: 15_001,
			fileCacheKey: "capture-1",
			byteLength: 3,
			width: 640,
			height: 480,
			hasAudio: true,
		});

		await expect(captureShortVideo()).rejects.toThrow();
	});

	it("emits redacted workflow diagnostics", () => {
		reportMediaWorkflowDiagnostic("photo_capture", "upload_failed", "error");

		expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
			category: "media_workflow",
			component: "photo_capture",
			code: "upload_failed",
			level: "error",
		});
	});
});
