import { describe, expect, it, vi } from "vitest";

import type { AlbumContentResponse } from "$lib/api/messaging/albums";
import {
	AlbumActivationService,
	type AlbumActivationServiceDependencies,
} from "./album-activation-service";
import {
	type AlbumPresetManifest,
	albumPresetManifestSchema,
} from "./album-presets";

function preset(checksum = "a".repeat(64)): AlbumPresetManifest {
	return albumPresetManifestSchema.parse({
		version: 1,
		presetId: "11111111-1111-4111-8111-111111111111",
		name: "Desired",
		createdAt: 1,
		updatedAt: 1,
		items: [
			{
				itemId: "22222222-2222-4222-8222-222222222222",
				kind: "image",
				mimeType: "image/jpeg",
				byteLength: 3,
				checksum,
				width: null,
				height: null,
				durationMs: null,
				order: 0,
			},
		],
	});
}

function album(contentIds: number[]): AlbumContentResponse {
	return {
		albumId: 9,
		albumName: "Live",
		profileId: 7,
		albumViewable: true,
		hasUnseenContent: false,
		sharedCount: 1,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		content: contentIds.map((contentId) => ({
			contentId,
			contentType: "image/jpeg",
			coverUrl: null,
			thumbUrl: "https://cdns.grindr.com/thumb",
			url: `https://cdns.grindr.com/${contentId}`,
			statusId: 1,
			processing: false,
			rejectionId: null,
		})),
	};
}

describe("AlbumActivationService", () => {
	it("captures recovery first, preserves shares, journals each mutation, and verifies", async () => {
		let contentIds = [1];
		const order: string[] = [];
		const recovery = preset("b".repeat(64));
		const saveJournal = vi.fn(() => Promise.resolve());
		const getShares = vi.fn(() => Promise.resolve([44]));
		const dependencies: AlbumActivationServiceDependencies = {
			getAlbum: () => Promise.resolve(album(contentIds)),
			getLimits: () =>
				Promise.resolve({
					subscriptionType: "test",
					maxAlbums: 1,
					maxContentItemsPerAlbum: 2,
					maxShares: 10,
					maxViewableAlbums: 1,
					maxViewableVideos: 1,
					maxContentSizeHumanReadable: "1 MB",
					maxContentSizeInBytes: 1024,
					maxVideoLength: 10,
					minVideoLength: 1,
					maxShareableAlbums: 1,
					maxVideosPerAlbum: 1,
				}),
			getShares,
			listPresets: () => Promise.resolve([]),
			snapshot: vi.fn(() => {
				order.push("snapshot");
				return Promise.resolve(recovery);
			}),
			deletePreset: () => Promise.resolve(),
			readPresetItem: () =>
				Promise.resolve({
					bytes: new Uint8Array([1, 2, 3]),
					mimeType: "image/jpeg",
				}),
			upload: vi.fn(() => {
				order.push("upload");
				contentIds.push(2);
				return Promise.resolve({ contentId: 2, contentUrl: null });
			}),
			deleteContent: vi.fn(({ contentId }) => {
				order.push("delete");
				contentIds = contentIds.filter((id) => id !== contentId);
				return Promise.resolve();
			}),
			reorder: vi.fn(({ contentIds: desiredOrder }) => {
				contentIds = desiredOrder;
				return Promise.resolve();
			}),
			saveJournal,
			now: () => 10,
			createId: vi
				.fn()
				.mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
				.mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
				.mockReturnValueOnce("55555555-5555-4555-8555-555555555555"),
		};

		const result = await new AlbumActivationService(dependencies).start({
			accountId: 7,
			targetAlbumId: 9,
			preset: preset(),
		});

		expect(result.status).toBe("completed");
		expect(order).toEqual(["snapshot", "upload", "delete"]);
		expect(contentIds).toEqual([2]);
		expect(saveJournal.mock.calls.length).toBeGreaterThanOrEqual(5);
		expect(getShares).toHaveBeenCalledTimes(3);
	});

	it("stops before mutation when current content conflicts with a resumed journal", async () => {
		const desired = preset();
		const upload = vi.fn();
		const saveJournal = vi.fn(() => Promise.resolve());
		const service = new AlbumActivationService({
			getAlbum: () => Promise.resolve(album([99])),
			getLimits: () =>
				Promise.resolve({
					subscriptionType: "test",
					maxAlbums: 1,
					maxContentItemsPerAlbum: 1,
					maxShares: 10,
					maxViewableAlbums: 1,
					maxViewableVideos: 1,
					maxContentSizeHumanReadable: "1 MB",
					maxContentSizeInBytes: 1024,
					maxVideoLength: 10,
					minVideoLength: 1,
					maxShareableAlbums: 1,
					maxVideosPerAlbum: 1,
				}),
			getShares: () => Promise.resolve([44]),
			listPresets: vi.fn(),
			snapshot: () => Promise.resolve(preset("b".repeat(64))),
			deletePreset: () => Promise.resolve(),
			readPresetItem: vi.fn(),
			upload,
			deleteContent: vi.fn(),
			reorder: vi.fn(),
			saveJournal,
			now: () => 10,
			createId: vi.fn(),
		});
		const result = await service.resume(
			7,
			{
				version: 1,
				journalId: "55555555-5555-4555-8555-555555555555",
				presetId: desired.presetId,
				targetAlbumId: 9,
				status: "active",
				plan: {
					version: 1,
					presetId: desired.presetId,
					desiredChecksums: ["a".repeat(64)],
					retainedContentIds: [],
					actions: [
						{
							id: "already-applied",
							kind: "upload",
							itemId: desired.items[0].itemId,
							expectedBefore: [],
							expectedAfter: ["a".repeat(64)],
						},
					],
				},
				completedActionIds: ["already-applied"],
				createdAt: 1,
				updatedAt: 1,
				contentChecksums: { "1": "a".repeat(64) },
				shareProfileIds: [44],
			},
			desired,
		);
		expect(result.status).toBe("conflict");
		expect(upload).not.toHaveBeenCalled();

		const abandoned = await service.cancel(7, result);
		expect(abandoned.status).toBe("cancelled");
		expect(abandoned.rollbackPromised).toBe(false);
		expect(saveJournal).toHaveBeenLastCalledWith(
			7,
			expect.objectContaining({ status: "cancelled" }),
		);
	});

	it("recognizes an upload that completed before its receipt was journaled", async () => {
		const desired = preset();
		const upload = vi.fn();
		const recoveredUpload = preset();
		const snapshot = vi.fn(() => Promise.resolve(recoveredUpload));
		const deletePreset = vi.fn(() => Promise.resolve());
		const saveJournal = vi.fn(() => Promise.resolve());
		const service = new AlbumActivationService({
			getAlbum: () => Promise.resolve(album([2])),
			getLimits: () =>
				Promise.resolve({
					subscriptionType: "test",
					maxAlbums: 1,
					maxContentItemsPerAlbum: 1,
					maxShares: 10,
					maxViewableAlbums: 1,
					maxViewableVideos: 1,
					maxContentSizeHumanReadable: "1 MB",
					maxContentSizeInBytes: 1024,
					maxVideoLength: 10,
					minVideoLength: 1,
					maxShareableAlbums: 1,
					maxVideosPerAlbum: 1,
				}),
			getShares: () => Promise.resolve([44]),
			listPresets: vi.fn(),
			snapshot,
			deletePreset,
			readPresetItem: vi.fn(),
			upload,
			deleteContent: vi.fn(),
			reorder: vi.fn(),
			saveJournal,
			now: () => 10,
			createId: vi
				.fn()
				.mockReturnValueOnce("33333333-3333-4333-8333-333333333333")
				.mockReturnValueOnce("44444444-4444-4444-8444-444444444444"),
		});
		const result = await service.resume(
			7,
			{
				version: 1,
				journalId: "55555555-5555-4555-8555-555555555555",
				presetId: desired.presetId,
				targetAlbumId: 9,
				status: "active",
				plan: {
					version: 1,
					presetId: desired.presetId,
					desiredChecksums: [desired.items[0].checksum],
					retainedContentIds: [],
					actions: [
						{
							id: "upload-interrupted-after-server-commit",
							kind: "upload",
							itemId: desired.items[0].itemId,
							expectedBefore: [],
							expectedAfter: [desired.items[0].checksum],
						},
					],
				},
				completedActionIds: [],
				createdAt: 1,
				updatedAt: 1,
				contentChecksums: {},
				shareProfileIds: [44],
			},
			desired,
		);

		expect(result.status).toBe("completed");
		expect(result.contentChecksums).toEqual({ "2": desired.items[0].checksum });
		expect(upload).not.toHaveBeenCalled();
		expect(snapshot).toHaveBeenCalledOnce();
		expect(deletePreset).toHaveBeenCalledOnce();
		expect(saveJournal).toHaveBeenCalled();
	});
});
