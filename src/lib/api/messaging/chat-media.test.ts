import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, readMediaBytesMock, saveMediaToDrawerMock } = vi.hoisted(
	() => ({
		invokeMock: vi.fn(),
		readMediaBytesMock: vi.fn(),
		saveMediaToDrawerMock: vi.fn(),
	}),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/platform/media-picker", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/platform/media-picker")>()),
	readMediaBytes: readMediaBytesMock,
}));
vi.mock("$lib/api/messaging/drawer", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api/messaging/drawer")>()),
	saveMediaToDrawer: saveMediaToDrawerMock,
}));

import { addMediaToDrawer } from "$lib/api/messaging/chat-media";
import type { PickedMedia } from "$lib/platform/media-picker";

const pickedMedia = {
	source: "desktop",
	key: "media-1",
	mimeType: "image/png",
	path: "/tmp/photo.png",
} satisfies PickedMedia;

beforeEach(() => {
	vi.restoreAllMocks();
	invokeMock.mockReset();
	readMediaBytesMock.mockReset();
	saveMediaToDrawerMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("addMediaToDrawer", () => {
	it("uploads selected media bytes, saves the upload to the drawer, and returns the drawer item", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_720_000_000_000);
		readMediaBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		invokeMock.mockResolvedValue({
			mediaId: 910_001,
			url: "https://cdns.grindr.com/images/chat/photo.jpg",
			mediaHash: "hash-1",
		});

		await expect(addMediaToDrawer(pickedMedia)).resolves.toEqual({
			id: 910_001,
			url: "https://cdns.grindr.com/images/chat/photo.jpg",
			contentType: "image/png",
			createdTs: 1_720_000_000_000,
			used: false,
			takenOnGrindr: false,
		});

		expect(readMediaBytesMock).toHaveBeenCalledWith(pickedMedia);
		expect(invokeMock).toHaveBeenCalledWith("upload_chat_media", {
			contentType: "image/png",
			takenOnGrindr: false,
			data: "AQID",
		});
		expect(saveMediaToDrawerMock).toHaveBeenCalledWith(910_001);
	});

	it("falls back to JPEG when picked media has no content type", async () => {
		readMediaBytesMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
		invokeMock.mockResolvedValue({
			mediaId: 910_002,
			url: "https://cdns.grindr.com/images/chat/fallback.jpg",
			mediaHash: "hash-2",
		});

		await addMediaToDrawer({
			...pickedMedia,
			mimeType: null,
		});

		expect(invokeMock).toHaveBeenCalledWith("upload_chat_media", {
			contentType: "image/jpeg",
			takenOnGrindr: false,
			data: "BAUG",
		});
	});

	it("does not save invalid upload responses to the drawer", async () => {
		readMediaBytesMock.mockResolvedValue(new Uint8Array([1]));
		invokeMock.mockResolvedValue({
			mediaId: "not-a-number",
			url: "not-a-url",
			mediaHash: "hash-3",
		});

		await expect(addMediaToDrawer(pickedMedia)).rejects.toThrow();
		expect(saveMediaToDrawerMock).not.toHaveBeenCalled();
	});
});
