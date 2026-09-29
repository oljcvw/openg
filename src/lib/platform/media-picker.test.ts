import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

<<<<<<< HEAD
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
=======
const { androidFsMock, invokeMock, openMock, platformMock } = vi.hoisted(
	() => ({
		androidFsMock: { showOpenFilePicker: vi.fn() },
		invokeMock: vi.fn(),
		openMock: vi.fn(),
		platformMock: vi.fn(),
	}),
);

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
	invoke: invokeMock,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
>>>>>>> origin/forgejo-sync
vi.mock("@tauri-apps/plugin-os", () => ({ platform: platformMock }));
vi.mock("tauri-plugin-android-fs-api", () => ({ AndroidFs: androidFsMock }));

import type { AndroidFsUri } from "tauri-plugin-android-fs-api";

<<<<<<< HEAD
import {
	pickMedia,
	pickMultipleMedia,
	readMediaBytes,
} from "$lib/platform/media-picker";
=======
import { pickMedia, pickMultipleMedia } from "$lib/platform/media-picker";
>>>>>>> origin/forgejo-sync

const photoUri = {
	uri: "content://photo/1",
	documentTopTreeUri: null,
} satisfies AndroidFsUri;

const videoUri = {
	uri: "content://video/2",
	documentTopTreeUri: null,
} satisfies AndroidFsUri;

const firstKey = "00000000-0000-4000-8000-000000000001";
const secondKey = "00000000-0000-4000-8000-000000000002";

const tauri = globalThis as { isTauri?: boolean };

function runningOnAndroid() {
	tauri.isTauri = true;
	platformMock.mockReturnValue("android");
}

beforeEach(() => {
<<<<<<< HEAD
	openMock.mockReset();
	platformMock.mockReset();
	readFileMock.mockReset();
	androidFsMock.getMimeType.mockReset();
	androidFsMock.readFile.mockReset();
=======
	invokeMock.mockReset();
	openMock.mockReset();
	platformMock.mockReset();
>>>>>>> origin/forgejo-sync
	androidFsMock.showOpenFilePicker.mockReset();
	platformMock.mockReturnValue("macos");
});

afterEach(() => {
	vi.restoreAllMocks();
	delete tauri.isTauri;
});

<<<<<<< HEAD
describe("readMediaBytes", () => {
	it("reads a desktop selection through the filesystem plugin", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		readFileMock.mockResolvedValue(bytes);

		await expect(
			readMediaBytes({
				source: "desktop",
				key: "desktop-1",
				mimeType: "image/png",
				path: "/tmp/photo.png",
			}),
		).resolves.toBe(bytes);

		expect(readFileMock).toHaveBeenCalledWith("/tmp/photo.png");
	});

	it("reads an Android selection through the android-fs plugin", async () => {
		const bytes = new Uint8Array([4, 5, 6]);
		androidFsMock.readFile.mockResolvedValue(bytes);

		await expect(
			readMediaBytes({
				source: "android",
				key: "android-1",
				mimeType: "image/jpeg",
				uri: photoUri,
			}),
		).resolves.toBe(bytes);

		expect(androidFsMock.readFile).toHaveBeenCalledWith(photoUri);
	});

	it("reads a web selection from the File itself", async () => {
		const file = new File([new Uint8Array([7, 8, 9])], "photo.jpg", {
			type: "image/jpeg",
		});

		await expect(
			readMediaBytes({
				source: "web",
				key: "web-1",
				mimeType: "image/jpeg",
				file,
			}),
		).resolves.toEqual(new Uint8Array([7, 8, 9]));
	});
});

=======
>>>>>>> origin/forgejo-sync
describe("pickMedia", () => {
	it("returns null when the desktop picker is cancelled", async () => {
		openMock.mockResolvedValue(null);

		await expect(pickMedia("image")).resolves.toBeNull();

		expect(openMock).toHaveBeenCalledWith({
<<<<<<< HEAD
			filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
			multiple: false,
		});
=======
			filters: [
				{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] },
			],
			multiple: false,
		});
		expect(invokeMock).not.toHaveBeenCalled();
>>>>>>> origin/forgejo-sync
	});

	it("wraps the single path a desktop picker resolves outside an array", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(firstKey);
		openMock.mockResolvedValue("/tmp/photo.png");

		await expect(pickMedia("image")).resolves.toEqual({
			source: "desktop",
			key: firstKey,
			mimeType: "image/png",
			path: "/tmp/photo.png",
		});
	});
<<<<<<< HEAD
=======

	it("asks the Android content picker for one video when picking a single video", async () => {
		runningOnAndroid();
		vi.spyOn(crypto, "randomUUID").mockReturnValue(firstKey);
		invokeMock.mockResolvedValue([videoUri.uri]);

		await expect(pickMedia("video")).resolves.toEqual({
			source: "android",
			key: firstKey,
			mimeType: null,
			uri: videoUri,
		});

		expect(invokeMock).toHaveBeenCalledExactlyOnceWith(
			"pick_android_media",
			{ mimeTypes: ["video/*"], multiple: false },
		);
	});
>>>>>>> origin/forgejo-sync
});

describe("pickMultipleMedia", () => {
	it("maps desktop selections to fresh keys and known MIME types", async () => {
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstKey)
			.mockReturnValueOnce(secondKey);
<<<<<<< HEAD
		openMock.mockResolvedValue(["/tmp/clip.webm", "/tmp/raw.unknown"]);
=======
		openMock.mockResolvedValue(["/tmp/clip.mov", "/tmp/raw.unknown"]);
>>>>>>> origin/forgejo-sync

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{
				source: "desktop",
				key: firstKey,
<<<<<<< HEAD
				mimeType: "video/webm",
				path: "/tmp/clip.webm",
=======
				mimeType: "video/quicktime",
				path: "/tmp/clip.mov",
>>>>>>> origin/forgejo-sync
			},
			{
				source: "desktop",
				key: secondKey,
				mimeType: null,
				path: "/tmp/raw.unknown",
			},
		]);

		expect(openMock).toHaveBeenCalledWith({
			filters: [
				{
					name: "Media",
<<<<<<< HEAD
					extensions: ["jpg", "jpeg", "png", "mp4", "webm"],
=======
					extensions: ["jpg", "jpeg", "png", "webp", "mp4", "mov"],
>>>>>>> origin/forgejo-sync
				},
			],
			multiple: true,
		});
	});

	it.each([
		["/tmp/photo.jpg", "image/jpeg"],
		["/tmp/photo.jpeg", "image/jpeg"],
		["/tmp/photo.PNG", "image/png"],
<<<<<<< HEAD
		["/tmp/clip.mp4", "video/mp4"],
		["/tmp/clip.webm", "video/webm"],
=======
		["/tmp/photo.webp", "image/webp"],
		["/tmp/clip.mp4", "video/mp4"],
		["/tmp/clip.MOV", "video/quicktime"],
		["/tmp/clip.webm", null],
>>>>>>> origin/forgejo-sync
		["/tmp/noextension", null],
	])("resolves the MIME type of %s to %s", async (path, mimeType) => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(firstKey);
		openMock.mockResolvedValue([path]);

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{ source: "desktop", key: firstKey, mimeType, path },
		]);
	});

	it("narrows the desktop filter to videos for the video kind", async () => {
		openMock.mockResolvedValue([]);

		await pickMultipleMedia("video");

		expect(openMock).toHaveBeenCalledWith({
<<<<<<< HEAD
			filters: [{ name: "Videos", extensions: ["mp4", "webm"] }],
=======
			filters: [{ name: "Videos", extensions: ["mp4", "mov"] }],
>>>>>>> origin/forgejo-sync
			multiple: true,
		});
	});

<<<<<<< HEAD
	it("uses Android gallery MIME filters and keeps the picker's URIs", async () => {
=======
	it("opens the Android picker for content when the system routes it to the Photo Picker", async () => {
>>>>>>> origin/forgejo-sync
		runningOnAndroid();
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstKey)
			.mockReturnValueOnce(secondKey);
<<<<<<< HEAD
		androidFsMock.showOpenFilePicker.mockResolvedValue([
			photoUri,
			videoUri,
		]);
		androidFsMock.getMimeType
			.mockResolvedValueOnce("image/jpeg")
			.mockResolvedValueOnce("video/mp4");

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{
				source: "android",
				key: firstKey,
				mimeType: "image/jpeg",
				uri: photoUri,
			},
			{
				source: "android",
				key: secondKey,
				mimeType: "video/mp4",
=======
		invokeMock.mockResolvedValue([photoUri.uri, videoUri.uri]);

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{ source: "android", key: firstKey, mimeType: null, uri: photoUri },
			{
				source: "android",
				key: secondKey,
				mimeType: null,
>>>>>>> origin/forgejo-sync
				uri: videoUri,
			},
		]);

<<<<<<< HEAD
		expect(androidFsMock.showOpenFilePicker).toHaveBeenCalledWith({
=======
		expect(invokeMock).toHaveBeenCalledExactlyOnceWith(
			"pick_android_media",
			{ mimeTypes: ["image/*", "video/*"], multiple: true },
		);
		expect(androidFsMock.showOpenFilePicker).not.toHaveBeenCalled();
		expect(openMock).not.toHaveBeenCalled();
	});

	it("resolves nothing without the gallery fallback when the Android content picker is cancelled", async () => {
		runningOnAndroid();
		invokeMock.mockResolvedValue([]);

		await expect(pickMultipleMedia("media")).resolves.toEqual([]);
		await expect(pickMedia("image")).resolves.toBeNull();

		expect(androidFsMock.showOpenFilePicker).not.toHaveBeenCalled();
	});

	it("falls back to the Android gallery picker with the same filters when the content picker is unsupported", async () => {
		runningOnAndroid();
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce(firstKey)
			.mockReturnValueOnce(secondKey);
		invokeMock.mockResolvedValue(null);
		androidFsMock.showOpenFilePicker.mockResolvedValue([
			photoUri,
			videoUri,
		]);

		await expect(pickMultipleMedia("media")).resolves.toEqual([
			{ source: "android", key: firstKey, mimeType: null, uri: photoUri },
			{
				source: "android",
				key: secondKey,
				mimeType: null,
				uri: videoUri,
			},
		]);

		expect(
			androidFsMock.showOpenFilePicker,
		).toHaveBeenCalledExactlyOnceWith({
>>>>>>> origin/forgejo-sync
			pickerType: "Gallery",
			mimeTypes: ["image/*", "video/*"],
			multiple: true,
		});
<<<<<<< HEAD
		expect(androidFsMock.getMimeType).toHaveBeenCalledWith(photoUri);
		expect(androidFsMock.getMimeType).toHaveBeenCalledWith(videoUri);
		expect(openMock).not.toHaveBeenCalled();
	});

	it("narrows the Android picker to videos for the video kind", async () => {
		runningOnAndroid();
		androidFsMock.showOpenFilePicker.mockResolvedValue([]);

		await pickMultipleMedia("video");
=======
		expect(openMock).not.toHaveBeenCalled();
	});

	it("narrows the Android gallery fallback to videos for the video kind", async () => {
		runningOnAndroid();
		invokeMock.mockResolvedValue(null);
		androidFsMock.showOpenFilePicker.mockResolvedValue([]);

		await expect(pickMultipleMedia("video")).resolves.toEqual([]);
>>>>>>> origin/forgejo-sync

		expect(androidFsMock.showOpenFilePicker).toHaveBeenCalledWith({
			pickerType: "Gallery",
			mimeTypes: ["video/*"],
			multiple: true,
		});
	});
});
