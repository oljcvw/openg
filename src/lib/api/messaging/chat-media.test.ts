import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, saveMediaToDrawerMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	saveMediaToDrawerMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/demo", () => ({
	demoEnabled: false,
	demoUploadChatMedia: vi.fn(),
}));
vi.mock("$lib/api/messaging/drawer", () => ({
	saveMediaToDrawer: saveMediaToDrawerMock,
}));

import {
	addCapturedPhotoToDrawer,
	uploadChatMedia,
	uploadExpiringChatVideo,
} from "$lib/api/messaging/chat-media";

describe("chat media upload", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		saveMediaToDrawerMock.mockReset();
		invokeMock.mockResolvedValue({
			mediaId: 42,
			url: "https://media.example/voice.aac",
			mediaHash: "a".repeat(64),
		});
	});

	it("passes voice duration without inventing looping", async () => {
		await uploadChatMedia(new Uint8Array([1, 2, 3]), "audio/aac", {
			length: 12_345,
			takenOnGrindr: false,
		});

		expect(invokeMock).toHaveBeenCalledWith("upload_chat_media", {
			contentType: "audio/aac",
			takenOnGrindr: false,
			length: 12_345,
			looping: undefined,
			data: "AQID",
		});
	});

	it("uploads captured photos as in-app media and saves them to the drawer", async () => {
		const result = await addCapturedPhotoToDrawer({
			status: "ready",
			dataBase64: "AQID",
			contentType: "image/jpeg",
			byteLength: 3,
			width: 1_024,
			height: 768,
		});

		expect(invokeMock).toHaveBeenCalledWith("upload_chat_media", {
			contentType: "image/jpeg",
			takenOnGrindr: true,
			length: undefined,
			looping: undefined,
			data: "AQID",
		});
		expect(saveMediaToDrawerMock).toHaveBeenCalledWith(42);
		expect(result).toMatchObject({ id: 42, takenOnGrindr: true, used: false });
	});

	it("uses the V5 expiring-video bridge contract without a content type", async () => {
		await uploadExpiringChatVideo({
			dataBase64: "AQID",
			durationMs: 14_500,
			looping: false,
		});

		expect(invokeMock).toHaveBeenCalledWith("upload_expiring_chat_video", {
			length: 14_500,
			looping: false,
			data: "AQID",
		});
	});
});
