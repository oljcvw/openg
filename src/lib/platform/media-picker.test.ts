import { beforeEach, describe, expect, it, vi } from "vitest";

const { androidFsMock, openMock, platformMock, readFileMock } = vi.hoisted(
	() => ({
		androidFsMock: {
			getMimeType: vi.fn(),
			readFile: vi.fn(),
			showOpenFilePicker: vi.fn(),
		},
		openMock: vi.fn(),
		platformMock: vi.fn(),
		readFileMock: vi.fn(),
	}),
);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: readFileMock }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: platformMock }));
vi.mock("tauri-plugin-android-fs-api", () => ({
	AndroidFs: androidFsMock,
}));

import {
	pickMedia,
	pickMultipleMedia,
	readMediaBytes,
	type PickedMedia,
} from "$lib/platform/media-picker";

beforeEach(() => {
	vi.restoreAllMocks();
	openMock.mockReset();
	platformMock.mockReset();
	readFileMock.mockReset();
	androidFsMock.getMimeType.mockReset();
	androidFsMock.readFile.mockReset();
	androidFsMock.showOpenFilePicker.mockReset();
	platformMock.mockReturnValue("macos");
});

describe("readMediaBytes", () => {
	it("reads desktop, Android, and web media from their source-specific APIs", async () => {
		const desktopBytes = new Uint8Array([1, 2, 3]);
		const androidBytes = new Uint8Array([4, 5, 6]);
		readFileMock.mockResolvedValue(desktopBytes);
		androidFsMock.readFile.mockResolvedValue(androidBytes);

		await expect(
			readMediaBytes({
				source: "desktop",
				key: "desktop-1",
				mimeType: "image/png",
				path: "/tmp/photo.png",
			}),
		).resolves.toBe(desktopBytes);
		await expect(
			readMediaBytes({
				source: "android",
				key: "android-1",
				mimeType: "image/jpeg",
				uri: "content://photo/1",
			} as unknown as PickedMedia),
		).resolves.toBe(androidBytes);

		await expect(
			readMediaBytes({
				source: "web",
				key: "web-1",
				mimeType: "image/jpeg",
				file: {
					arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8, 9]).buffer),
				} as File,
			}),
		).resolves.toEqual(new Uint8Array([7, 8, 9]));

		expect(readFileMock).toHaveBeenCalledWith("/tmp/photo.png");
		expect(androidFsMock.readFile).toHaveBeenCalledWith("content://photo/1");
	});
});

describe("pickMedia", () => {
	it("returns null when the desktop picker is cancelled", async () => {
		openMock.mockResolvedValue(null);

		await expect(pickMedia("image")).resolves.toBeNull();

		expect(openMock).toHaveBeenCalledWith({
			filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
			multiple: false,
		});
	});

	it("maps desktop selections to stable keys and MIME types", async () => {
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
		openMock.mockResolvedValue(["/tmp/clip.webm", "/tmp/raw.unknown"]);

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{
				source: "desktop",
				key: "00000000-0000-4000-8000-000000000001",
				mimeType: "video/webm",
				path: "/tmp/clip.webm",
			},
			{
				source: "desktop",
				key: "00000000-0000-4000-8000-000000000002",
				mimeType: null,
				path: "/tmp/raw.unknown",
			},
		]);

		expect(openMock).toHaveBeenCalledWith({
			filters: [
				{
					name: "Media",
					extensions: ["jpg", "jpeg", "png", "mp4", "webm"],
				},
			],
			multiple: true,
		});
	});

	it("uses Android gallery MIME filters and preserves returned content types", async () => {
		platformMock.mockReturnValue("android");
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
		androidFsMock.showOpenFilePicker.mockResolvedValue([
			"content://photo/1",
			"content://video/2",
		]);
		androidFsMock.getMimeType
			.mockResolvedValueOnce("image/jpeg")
			.mockResolvedValueOnce("video/mp4");

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{
				source: "android",
				key: "00000000-0000-4000-8000-000000000001",
				mimeType: "image/jpeg",
				uri: "content://photo/1",
			},
			{
				source: "android",
				key: "00000000-0000-4000-8000-000000000002",
				mimeType: "video/mp4",
				uri: "content://video/2",
			},
		]);

		expect(androidFsMock.showOpenFilePicker).toHaveBeenCalledWith({
			pickerType: "Gallery",
			mimeTypes: ["image/*", "video/*"],
			multiple: true,
		});
	});
});
