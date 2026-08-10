import {
	deleteAlbumContent,
	getAlbumContent,
	getAlbumLimits,
	getAlbumShares,
	reorderAlbumContent,
	uploadAlbumMediaBytes,
} from "$lib/api/messaging/albums";
import type { AlbumContentResponse } from "$lib/api/messaging/albums";
import {
	deleteAlbumPreset,
	listAlbumPresets,
	readAlbumPresetItem,
	saveAlbumActivationJournal,
	snapshotRemoteAlbumPreset,
} from "./album-preset-store";
import {
	type AlbumActivationAction,
	type AlbumActivationJournal,
	type AlbumPresetManifest,
	buildAlbumActivationPlan,
} from "./album-presets";

export type AlbumActivationServiceDependencies = {
	getAlbum(albumId: number): Promise<AlbumContentResponse>;
	getLimits(): ReturnType<typeof getAlbumLimits>;
	getShares(albumId: number): Promise<number[]>;
	listPresets(accountId: number): Promise<AlbumPresetManifest[]>;
	snapshot(
		input: Parameters<typeof snapshotRemoteAlbumPreset>[0],
	): Promise<AlbumPresetManifest>;
	deletePreset(accountId: number, presetId: string): Promise<void>;
	readPresetItem: typeof readAlbumPresetItem;
	upload: typeof uploadAlbumMediaBytes;
	deleteContent: typeof deleteAlbumContent;
	reorder: typeof reorderAlbumContent;
	saveJournal: typeof saveAlbumActivationJournal;
	now(): number;
	createId(): string;
};

const defaultDependencies: AlbumActivationServiceDependencies = {
	getAlbum: (albumId) => getAlbumContent(albumId),
	getLimits: getAlbumLimits,
	getShares: getAlbumShares,
	listPresets: listAlbumPresets,
	snapshot: snapshotRemoteAlbumPreset,
	deletePreset: deleteAlbumPreset,
	readPresetItem: readAlbumPresetItem,
	upload: uploadAlbumMediaBytes,
	deleteContent: deleteAlbumContent,
	reorder: reorderAlbumContent,
	saveJournal: saveAlbumActivationJournal,
	now: Date.now,
	createId: () => crypto.randomUUID(),
};

function same(left: readonly string[], right: readonly string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function sameNumbers(left: readonly number[], right: readonly number[]) {
	return same(left.map(String).toSorted(), right.map(String).toSorted());
}

function checksumSequence(
	album: AlbumContentResponse,
	contentChecksums: Record<string, string>,
): string[] {
	return album.content.map(
		(item) =>
			contentChecksums[String(item.contentId)] ?? `unknown:${item.contentId}`,
	);
}

function sameManifestItems(
	left: AlbumPresetManifest,
	right: AlbumPresetManifest,
): boolean {
	return same(
		left.items
			.toSorted((a, b) => a.order - b.order)
			.map((item) => item.checksum),
		right.items
			.toSorted((a, b) => a.order - b.order)
			.map((item) => item.checksum),
	);
}

const activeTargets = new Set<string>();

/**
 * Performs the intentionally non-atomic, resumable saved-set reconciliation.
 * It never calls a share or unshare endpoint. The encrypted journal is saved
 * after every externally visible step.
 */
export class AlbumActivationService {
	readonly #dependencies: AlbumActivationServiceDependencies;

	constructor(
		dependencies: AlbumActivationServiceDependencies = defaultDependencies,
	) {
		this.#dependencies = dependencies;
	}

	async start({
		accountId,
		targetAlbumId,
		preset,
	}: {
		accountId: number;
		targetAlbumId: number;
		preset: AlbumPresetManifest;
	}): Promise<AlbumActivationJournal> {
		const targetKey = `${accountId}:${targetAlbumId}`;
		if (activeTargets.has(targetKey))
			throw new Error(
				"An album activation is already running for this live album",
			);
		activeTargets.add(targetKey);
		try {
			const [album, limits, shares, existingPresets] = await Promise.all([
				this.#dependencies.getAlbum(targetAlbumId),
				this.#dependencies.getLimits(),
				this.#dependencies.getShares(targetAlbumId),
				this.#dependencies.listPresets(accountId),
			]);
			if (album.profileId !== accountId)
				throw new Error("Only an owned live album can be activated");
			if (album.content.some((item) => item.url === ""))
				throw new Error(
					"The current live album could not be captured completely",
				);

			const recovery = await this.#dependencies.snapshot({
				accountId,
				presetId: this.#dependencies.createId(),
				name: `Recovery ${new Date(this.#dependencies.now()).toISOString()}`,
				items: album.content.map((item) => ({
					itemId: this.#dependencies.createId(),
					kind: item.contentType.startsWith("video/") ? "video" : "image",
					mimeType: item.contentType as
						| "image/jpeg"
						| "image/png"
						| "video/mp4"
						| "video/webm",
					sourceUrl: item.url,
					maximumBytes: limits.maxContentSizeInBytes,
					width: null,
					height: null,
					durationMs: null,
				})),
			});
			const identical = existingPresets.find((candidate) =>
				sameManifestItems(candidate, recovery),
			);
			const recoveryPresetId = identical?.presetId ?? recovery.presetId;
			if (identical)
				await this.#dependencies.deletePreset(accountId, recovery.presetId);

			const live = album.content.map((item, index) => ({
				contentId: item.contentId,
				checksum: recovery.items[index].checksum,
				kind: item.contentType.startsWith("video/")
					? ("video" as const)
					: ("image" as const),
				order: index,
			}));
			const plan = buildAlbumActivationPlan({
				desired: preset,
				live,
				limits: {
					maxItems: limits.maxContentItemsPerAlbum,
					maxVideos: limits.maxVideosPerAlbum,
				},
			});
			const now = this.#dependencies.now();
			const journal: AlbumActivationJournal = {
				version: 1,
				journalId: this.#dependencies.createId(),
				presetId: preset.presetId,
				targetAlbumId,
				status: "active",
				plan,
				completedActionIds: [],
				createdAt: now,
				updatedAt: now,
				recoveryPresetId,
				contentChecksums: Object.fromEntries(
					live.map((item) => [String(item.contentId), item.checksum]),
				),
				shareProfileIds: [...shares],
			};
			await this.#dependencies.saveJournal(accountId, journal);
			return await this.#resumeUnlocked(accountId, journal, preset);
		} finally {
			activeTargets.delete(targetKey);
		}
	}

	async resume(
		accountId: number,
		journal: AlbumActivationJournal,
		preset: AlbumPresetManifest,
	): Promise<AlbumActivationJournal> {
		const targetKey = `${accountId}:${journal.targetAlbumId}`;
		if (activeTargets.has(targetKey))
			throw new Error(
				"An album activation is already running for this live album",
			);
		activeTargets.add(targetKey);
		try {
			return await this.#resumeUnlocked(accountId, journal, preset);
		} finally {
			activeTargets.delete(targetKey);
		}
	}

	async cancel(
		accountId: number,
		journal: AlbumActivationJournal,
	): Promise<AlbumActivationJournal> {
		if (journal.status === "completed" || journal.status === "cancelled")
			return journal;
		return await this.#persist(accountId, {
			...journal,
			status: "cancelled",
			rollbackPromised: false,
		});
	}

	async #resumeUnlocked(
		accountId: number,
		journal: AlbumActivationJournal,
		preset: AlbumPresetManifest,
	): Promise<AlbumActivationJournal> {
		if (journal.status !== "active") return journal;
		let current: AlbumActivationJournal = {
			...journal,
			completedActionIds: [...journal.completedActionIds],
			contentChecksums: { ...journal.contentChecksums },
		};
		const shares = await this.#dependencies.getShares(current.targetAlbumId);
		if (!sameNumbers(shares, current.shareProfileIds ?? []))
			return await this.#persist(accountId, { ...current, status: "conflict" });

		const completed = new Set(current.completedActionIds);
		const lastCompleted = current.plan.actions.findLast((item) =>
			completed.has(item.id),
		);
		if (lastCompleted) {
			const album = await this.#dependencies.getAlbum(current.targetAlbumId);
			const observation = await this.#observeAlbum(accountId, current, album);
			current = observation.journal;
			const observed = observation.sequence;
			if (!same(observed, lastCompleted.expectedAfter))
				return await this.#persist(accountId, {
					...current,
					status: "conflict",
				});
		}

		for (const next of current.plan.actions) {
			if (completed.has(next.id)) continue;
			const album = await this.#dependencies.getAlbum(current.targetAlbumId);
			const beforeObservation = await this.#observeAlbum(
				accountId,
				current,
				album,
			);
			current = beforeObservation.journal;
			const before = beforeObservation.sequence;
			if (same(before, next.expectedAfter)) {
				completed.add(next.id);
				current = await this.#persist(accountId, {
					...current,
					completedActionIds: [...completed],
				});
				continue;
			}
			if (!same(before, next.expectedBefore))
				return await this.#persist(accountId, {
					...current,
					status: "conflict",
				});

			current = await this.#execute(accountId, current, preset, album, next);
			const afterAlbum = await this.#dependencies.getAlbum(
				current.targetAlbumId,
			);
			const afterObservation = await this.#observeAlbum(
				accountId,
				current,
				afterAlbum,
			);
			current = afterObservation.journal;
			const after = afterObservation.sequence;
			if (!same(after, next.expectedAfter))
				return await this.#persist(accountId, {
					...current,
					status: "conflict",
				});
			completed.add(next.id);
			current = await this.#persist(accountId, {
				...current,
				completedActionIds: [...completed],
			});
		}
		const finalShares = await this.#dependencies.getShares(
			current.targetAlbumId,
		);
		if (!sameNumbers(finalShares, current.shareProfileIds ?? []))
			return await this.#persist(accountId, { ...current, status: "conflict" });
		return await this.#persist(accountId, { ...current, status: "completed" });
	}

	async #observeAlbum(
		accountId: number,
		journal: AlbumActivationJournal,
		album: AlbumContentResponse,
	): Promise<{ journal: AlbumActivationJournal; sequence: string[] }> {
		const known = journal.contentChecksums ?? {};
		const unresolved = album.content.filter(
			(item) => known[String(item.contentId)] === undefined,
		);
		if (unresolved.length === 0)
			return { journal, sequence: checksumSequence(album, known) };
		if (unresolved.some((item) => item.url === ""))
			return { journal, sequence: checksumSequence(album, known) };

		const limits = await this.#dependencies.getLimits();
		const temporaryPresetId = this.#dependencies.createId();
		const snapshot = await this.#dependencies.snapshot({
			accountId,
			presetId: temporaryPresetId,
			name: "Activation reconciliation",
			items: unresolved.map((item) => ({
				itemId: this.#dependencies.createId(),
				kind: item.contentType.startsWith("video/") ? "video" : "image",
				mimeType: item.contentType as
					| "image/jpeg"
					| "image/png"
					| "video/mp4"
					| "video/webm",
				sourceUrl: item.url,
				maximumBytes: limits.maxContentSizeInBytes,
				width: null,
				height: null,
				durationMs: null,
			})),
		});
		const resolved = { ...known };
		for (const [index, item] of unresolved.entries()) {
			const checksum = snapshot.items[index]?.checksum;
			if (checksum) resolved[String(item.contentId)] = checksum;
		}
		await this.#dependencies.deletePreset(accountId, temporaryPresetId);
		const updated = await this.#persist(accountId, {
			...journal,
			contentChecksums: resolved,
		});
		return { journal: updated, sequence: checksumSequence(album, resolved) };
	}

	async #execute(
		accountId: number,
		journal: AlbumActivationJournal,
		preset: AlbumPresetManifest,
		album: AlbumContentResponse,
		action: AlbumActivationAction,
	): Promise<AlbumActivationJournal> {
		switch (action.kind) {
			case "retain":
			case "verify":
				return journal;
			case "upload": {
				const item = preset.items.find(
					(candidate) => candidate.itemId === action.itemId,
				);
				if (!item) throw new Error("Saved-set upload item is unavailable");
				const stored = await this.#dependencies.readPresetItem(
					accountId,
					preset.presetId,
					item.itemId,
				);
				const uploaded = await this.#dependencies.upload({
					albumId: journal.targetAlbumId,
					contentType: stored.mimeType,
					bytes: stored.bytes,
				});
				return await this.#persist(accountId, {
					...journal,
					contentChecksums: {
						...journal.contentChecksums,
						[String(uploaded.contentId)]: item.checksum,
					},
				});
			}
			case "delete":
				if (action.contentId === undefined)
					throw new Error("Saved-set delete action is invalid");
				await this.#dependencies.deleteContent({
					albumId: journal.targetAlbumId,
					contentId: action.contentId,
				});
				return journal;
			case "reorder": {
				const remaining = [...album.content];
				const orderedIds = action.expectedAfter.map((checksum) => {
					const index = remaining.findIndex(
						(item) =>
							journal.contentChecksums?.[String(item.contentId)] === checksum,
					);
					if (index < 0)
						throw new Error("Saved-set target order is unresolved");
					return remaining.splice(index, 1)[0].contentId;
				});
				await this.#dependencies.reorder({
					albumId: journal.targetAlbumId,
					contentIds: orderedIds,
				});
				return journal;
			}
		}
	}

	async #persist(
		accountId: number,
		journal: AlbumActivationJournal,
	): Promise<AlbumActivationJournal> {
		const updated = { ...journal, updatedAt: this.#dependencies.now() };
		await this.#dependencies.saveJournal(accountId, updated);
		return updated;
	}
}
