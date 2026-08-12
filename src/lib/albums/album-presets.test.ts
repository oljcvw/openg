import { describe, expect, it, vi } from "vitest";

import {
	AlbumActivationCoordinator,
	type AlbumActivationJournal,
	type AlbumPresetManifest,
	albumPresetManifestSchema,
	buildAlbumActivationPlan,
} from "./album-presets";

function manifest(
	checksums: string[] = ["a".repeat(64), "b".repeat(64)],
): AlbumPresetManifest {
	return albumPresetManifestSchema.parse({
		version: 1,
		presetId: "11111111-1111-4111-8111-111111111111",
		name: "Weekend",
		createdAt: 1,
		updatedAt: 2,
		items: checksums.map((checksum, index) => ({
			itemId: `22222222-2222-4222-8222-22222222222${index}`,
			kind: "image",
			mimeType: "image/jpeg",
			byteLength: 100 + index,
			checksum,
			width: 400,
			height: 300,
			durationMs: null,
			order: index,
		})),
	});
}

describe("album preset manifests", () => {
	it("rejects signed URLs, arbitrary fields, duplicate order, and invalid media", () => {
		const valid = manifest();
		expect(
			albumPresetManifestSchema.safeParse({ ...valid, signedUrl: "secret" })
				.success,
		).toBe(false);
		expect(
			albumPresetManifestSchema.safeParse({
				...valid,
				items: valid.items.map((item) => ({ ...item, order: 0 })),
			}).success,
		).toBe(false);
		expect(
			albumPresetManifestSchema.safeParse({
				...valid,
				items: [{ ...valid.items[0]!, mimeType: "text/plain" }],
			}).success,
		).toBe(false);
	});
});

describe("album activation planning", () => {
	it("retains matches, uploads before deleting when capacity permits, and never changes shares", () => {
		const desired = manifest(["a".repeat(64), "c".repeat(64)]);
		const plan = buildAlbumActivationPlan({
			desired,
			live: [
				{ contentId: 10, checksum: "a".repeat(64), kind: "image", order: 0 },
				{ contentId: 11, checksum: "b".repeat(64), kind: "image", order: 1 },
			],
			limits: { maxItems: 3, maxVideos: 1 },
		});

		expect(plan.actions.map((action) => action.kind)).toEqual([
			"retain",
			"upload",
			"delete",
			"reorder",
			"verify",
		]);
		expect(plan.actions.map((action) => action.kind)).not.toContain("share");
	});

	it("fails closed when a saved set exceeds current service limits", () => {
		expect(() =>
			buildAlbumActivationPlan({
				desired: manifest(),
				live: [],
				limits: { maxItems: 1, maxVideos: 1 },
			}),
		).toThrow(/current 1-item limit/);
	});
});

describe("AlbumActivationCoordinator", () => {
	it("resumes idempotently and stops on conflicting external state", async () => {
		const desired = manifest(["a".repeat(64)]);
		const journal: AlbumActivationJournal = {
			version: 1,
			journalId: "33333333-3333-4333-8333-333333333333",
			presetId: desired.presetId,
			targetAlbumId: 9,
			status: "active",
			plan: buildAlbumActivationPlan({
				desired,
				live: [],
				limits: { maxItems: 2, maxVideos: 1 },
			}),
			completedActionIds: [],
			createdAt: 1,
			updatedAt: 1,
		};
		let checksums: string[] = [];
		const execute = vi.fn(() => {
			checksums = ["a".repeat(64)];
			return Promise.resolve();
		});
		const save = vi.fn(() => Promise.resolve());
		const coordinator = new AlbumActivationCoordinator({
			inspect: () => Promise.resolve(checksums),
			execute,
			saveJournal: save,
		});

		const completed = await coordinator.resume(journal);
		expect(completed.status).toBe("completed");
		expect(execute).toHaveBeenCalledTimes(1);
		expect(await coordinator.resume(completed)).toBe(completed);

		const conflicting: AlbumActivationJournal = {
			...journal,
			completedActionIds: [journal.plan.actions[0]!.id],
		};
		checksums = ["f".repeat(64)];
		expect((await coordinator.resume(conflicting)).status).toBe("conflict");
	});

	it("cancels future steps without claiming rollback", async () => {
		const desired = manifest();
		const journal: AlbumActivationJournal = {
			version: 1,
			journalId: "33333333-3333-4333-8333-333333333333",
			presetId: desired.presetId,
			targetAlbumId: 9,
			status: "active",
			plan: buildAlbumActivationPlan({
				desired,
				live: [],
				limits: { maxItems: 3, maxVideos: 1 },
			}),
			completedActionIds: [],
			createdAt: 1,
			updatedAt: 1,
		};
		const saveJournal = vi.fn(() => Promise.resolve());
		const coordinator = new AlbumActivationCoordinator({
			inspect: () => Promise.resolve([]),
			execute: () => Promise.resolve(),
			saveJournal,
		});
		const cancelled = await coordinator.cancel(journal);
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.rollbackPromised).toBe(false);
	});
});
