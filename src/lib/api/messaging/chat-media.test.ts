import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/demo", () => ({
	demoEnabled: false,
	demoUploadChatMedia: vi.fn(),
}));

import { uploadChatMedia } from "$lib/api/messaging/chat-media";

describe("chat media upload", () => {
	beforeEach(() => {
		invokeMock.mockReset();
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
});
