import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock, invokeMock, readMediaBytesMock } = vi.hoisted(() => ({
	fetchRestMock: vi.fn(),
	invokeMock: vi.fn(),
	readMediaBytesMock: vi.fn(),
}));

vi.mock("$lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api")>()),
	fetchRest: fetchRestMock,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/platform/media-picker", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/platform/media-picker")>()),
	readMediaBytes: readMediaBytesMock,
}));

import {
	createAlbum,
	deleteAlbum,
	deleteAlbumContent,
	getAlbumContent,
	getAlbumLimits,
	getAlbumShares,
	getAlbumsSharedByProfile,
	getMyAlbums,
	recordAlbumContentView,
	renameAlbum,
	reorderAlbumContent,
	shareAlbum,
	unshareAlbum,
	uploadAlbumMedia,
} from "$lib/api/messaging/albums";

function albumContent(contentId = 1) {
	return {
		contentId,
		contentType: "image/jpeg",
		coverUrl: "https://example.com/cover.jpg",
		statusId: 1,
		thumbUrl: "https://example.com/thumb.jpg",
		url: "https://example.com/full.jpg",
		processing: false,
		rejectionId: null,
	};
}

function myAlbum(albumId = 1) {
	return {
		albumId,
		albumName: "Gym",
		profileId: 42,
		version: 1,
		content: [albumContent()],
		isShareable: true,
		sharedCount: 0,
		createdAt: "2026-03-27T20:39:00",
		updatedAt: "2026-03-27T20:39:00",
	};
}

function response(data?: unknown, status = 200) {
	return {
		status,
		assertOk() {
			if (status < 200 || status >= 300) {
				throw new Error(`mock assertOk rejected status ${status}`);
			}
		},
		jsonParsed: vi.fn((schema: { parse(value: unknown): unknown }) =>
			schema.parse(data),
		),
	};
}

beforeEach(() => {
	fetchRestMock.mockReset();
	invokeMock.mockReset();
	readMediaBytesMock.mockReset();
});

describe("getAlbumContent", () => {
	it("forwards cancellation to album metadata loading", async () => {
		fetchRestMock.mockResolvedValue(
			response({
				...myAlbum(42),
				hasUnseenContent: false,
				albumViewable: true,
			}),
		);
		const controller = new AbortController();

		await getAlbumContent(42, { signal: controller.signal });

		expect(fetchRestMock).toHaveBeenCalledWith("/v2/albums/42", {
			signal: controller.signal,
		});
	});
});

describe("recordAlbumContentView", () => {
	it("records the viewed item and returns remaining views", async () => {
		fetchRestMock.mockResolvedValue(response({ remainingViews: 0 }));

		await expect(
			recordAlbumContentView({ albumId: 42, contentId: 7 }),
		).resolves.toEqual({ remainingViews: 0 });
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/42/view/content/7", {
			method: "POST",
		});
	});
});

describe("getMyAlbums", () => {
	it("requests the album list and unwraps it", async () => {
		fetchRestMock.mockResolvedValue(response({ albums: [myAlbum()] }));

		await expect(getMyAlbums()).resolves.toEqual([myAlbum()]);
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums");
	});

	it("accepts a null album name", async () => {
		const album = { ...myAlbum(), albumName: null };
		fetchRestMock.mockResolvedValue(response({ albums: [album] }));

		await expect(getMyAlbums()).resolves.toEqual([album]);
	});
});

describe("getAlbumsSharedByProfile", () => {
	it("requests the profile's shared albums and unwraps them", async () => {
		const album = {
			albumId: 5,
			hasUnseenContent: true,
			albumName: "Shared",
			profileId: 42,
			albumViewable: true,
			expiresAt: null,
			expirationType: "INDEFINITE",
			content: {
				contentId: 500,
				contentType: "image/jpeg",
				coverUrl: "https://example.com/cover.jpg",
				statusId: 1,
			},
			contentCount: { imageCount: 3, videoCount: 1 },
		};
		fetchRestMock.mockResolvedValue(response({ albums: [album] }));

		await expect(getAlbumsSharedByProfile(42)).resolves.toEqual([album]);
		expect(fetchRestMock).toHaveBeenCalledWith("/v2/albums/shares/42");
	});

	it("tolerates a missing preview and counts", async () => {
		const album = {
			albumId: 5,
			hasUnseenContent: false,
			albumName: null,
			profileId: 42,
			albumViewable: false,
			expiresAt: null,
			expirationType: null,
		};
		fetchRestMock.mockResolvedValue(response({ albums: [album] }));

		await expect(getAlbumsSharedByProfile(42)).resolves.toEqual([album]);
	});
});

describe("getAlbumLimits", () => {
	it("parses the storage limits", async () => {
		const responseLimits = {
			subscriptionType: "FreeAlbums",
			maxAlbums: 10,
			maxContentItemsPerAlbum: 30,
			maxShares: 100,
			maxViewableAlbums: 10,
			maxViewableVideos: 10,
			maxContentSize: 125_829_120,
			maxContentSizeHumanReadable: "120.00 MB",
			maxVideoLength: 60,
			minVideoLength: 1,
			maxShareableAlbums: 10,
			maxVideosPerAlbum: 10,
		};
		fetchRestMock.mockResolvedValue(response(responseLimits));
		const { maxContentSize, ...otherLimits } = responseLimits;

		await expect(getAlbumLimits()).resolves.toEqual({
			...otherLimits,
			maxContentSizeInBytes: maxContentSize,
		});
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/storage");
	});

	it("tolerates the older byte-limit field name", async () => {
		const limits = {
			subscriptionType: "FreeAlbums",
			maxAlbums: 10,
			maxContentItemsPerAlbum: 30,
			maxShares: 100,
			maxViewableAlbums: 10,
			maxViewableVideos: 10,
			maxContentSizeInBytes: 125_829_120,
			maxContentSizeHumanReadable: "120.00 MB",
			maxVideoLength: 60,
			minVideoLength: 1,
			maxShareableAlbums: 10,
			maxVideosPerAlbum: 10,
		};
		fetchRestMock.mockResolvedValue(response(limits));

		await expect(getAlbumLimits()).resolves.toEqual(limits);
	});
});

describe("createAlbum", () => {
	it("posts the name and returns the new album", async () => {
		fetchRestMock.mockResolvedValue(
			response({ albumId: 12, albumName: "Gym" }),
		);

		await expect(createAlbum({ albumName: "Gym" })).resolves.toEqual({
			albumId: 12,
			albumName: "Gym",
		});
		expect(fetchRestMock).toHaveBeenCalledWith("/v2/albums", {
			method: "POST",
			body: { albumName: "Gym" },
		});
	});

	it("surfaces the 402 returned at the album cap", async () => {
		fetchRestMock.mockResolvedValue(response(undefined, 402));

		await expect(createAlbum({ albumName: null })).rejects.toThrow(
			"mock assertOk rejected status 402",
		);
	});
});

describe("renameAlbum", () => {
	it("puts the new name", async () => {
		fetchRestMock.mockResolvedValue(response({ albumId: 12, albumName: null }));

		await expect(
			renameAlbum({ albumId: 12, albumName: null }),
		).resolves.toEqual({ albumId: 12, albumName: null });
		expect(fetchRestMock).toHaveBeenCalledWith("/v2/albums/12", {
			method: "PUT",
			body: { albumName: null },
		});
	});
});

describe("deleteAlbum", () => {
	it("deletes by id", async () => {
		fetchRestMock.mockResolvedValue(response());

		await deleteAlbum({ albumId: 12 });

		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/12", {
			method: "DELETE",
		});
	});
});

describe("reorderAlbumContent", () => {
	it("posts the full content order", async () => {
		fetchRestMock.mockResolvedValue(response());

		await reorderAlbumContent({ albumId: 12, contentIds: [3, 1, 2] });

		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/12/content/order", {
			method: "POST",
			body: { contentIds: [3, 1, 2] },
		});
	});
});

describe("deleteAlbumContent", () => {
	it("deletes a single item", async () => {
		fetchRestMock.mockResolvedValue(response());

		await deleteAlbumContent({ albumId: 12, contentId: 7 });

		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/12/content/7", {
			method: "DELETE",
		});
	});
});

describe("uploadAlbumMedia", () => {
	const media = {
		source: "web" as const,
		key: "picked",
		mimeType: "image/png",
		file: new File([], "photo.png"),
	};

	it("reads selected media and invokes the native multipart boundary", async () => {
		readMediaBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
		invokeMock.mockResolvedValue({
			contentId: 77,
			contentUrl: "https://example.com/upload.png",
		});

		await expect(
			uploadAlbumMedia({ albumId: 12, media, maxBytes: 100 }),
		).resolves.toEqual({
			contentId: 77,
			contentUrl: "https://example.com/upload.png",
		});
		expect(invokeMock).toHaveBeenCalledWith("upload_album_media", {
			albumId: 12,
			contentType: "image/png",
			data: "AQID",
		});
	});

	it("rejects oversized media before native IPC", async () => {
		readMediaBytesMock.mockResolvedValue(new Uint8Array(101));

		await expect(
			uploadAlbumMedia({ albumId: 12, media, maxBytes: 100 }),
		).rejects.toThrow("exceeds");
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("rejects unknown content types before reading media", async () => {
		await expect(
			uploadAlbumMedia({
				albumId: 12,
				media: { ...media, mimeType: null },
				maxBytes: 100,
			}),
		).rejects.toThrow("Unsupported or unknown");
		expect(readMediaBytesMock).not.toHaveBeenCalled();
	});
});

describe("getAlbumShares", () => {
	it("returns the shared-with profile ids", async () => {
		fetchRestMock.mockResolvedValue(response({ profileIds: [42, 43] }));

		await expect(getAlbumShares(12)).resolves.toEqual([42, 43]);
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/12/shares");
	});

	it("treats a missing list as no shares", async () => {
		fetchRestMock.mockResolvedValue(response({}));

		await expect(getAlbumShares(12)).resolves.toEqual([]);
	});
});

describe("unshareAlbum", () => {
	it("uses the documented zero share-id sentinel for each profile", async () => {
		fetchRestMock.mockResolvedValue(response());

		await unshareAlbum({ albumId: 12, profileIds: [42, 43] });

		expect(fetchRestMock).toHaveBeenCalledWith("/v1/albums/12/unshares", {
			method: "PUT",
			body: {
				profiles: [
					{ profileId: 42, shareId: 0 },
					{ profileId: 43, shareId: 0 },
				],
			},
		});
	});

	it("propagates a failed response", async () => {
		fetchRestMock.mockResolvedValue(response(undefined, 403));

		await expect(
			unshareAlbum({ albumId: 12, profileIds: [42] }),
		).rejects.toThrow("mock assertOk rejected status 403");
	});
});

describe("shareAlbum", () => {
	it("posts one entry per profile with the expiration", async () => {
		fetchRestMock.mockResolvedValue(response());

		await shareAlbum({
			albumId: 7,
			profileIds: [42, 43],
			expirationType: "ONE_HOUR",
		});

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/albums/7/shares", {
			method: "POST",
			body: {
				profiles: [
					{ profileId: 42, expirationType: "ONE_HOUR" },
					{ profileId: 43, expirationType: "ONE_HOUR" },
				],
			},
		});
	});

	it("propagates a failed response", async () => {
		fetchRestMock.mockResolvedValue(response(undefined, 403));

		await expect(
			shareAlbum({
				albumId: 7,
				profileIds: [42],
				expirationType: "INDEFINITE",
			}),
		).rejects.toThrow("mock assertOk rejected status 403");
	});
});
