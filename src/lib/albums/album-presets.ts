import z from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const presetMediaKindSchema = z.enum(["image", "video"]);
const presetMimeTypeSchema = z.enum([
	"image/jpeg",
	"image/png",
	"video/mp4",
	"video/webm",
]);

export const albumPresetItemSchema = z
	.object({
		itemId: z.uuid(),
		kind: presetMediaKindSchema,
		mimeType: presetMimeTypeSchema,
		byteLength: z.int().positive(),
		checksum: sha256Schema,
		width: z.int().positive().nullable(),
		height: z.int().positive().nullable(),
		durationMs: z.int().nonnegative().nullable(),
		order: z.int().nonnegative(),
	})
	.strict()
	.refine(
		(item) =>
			(item.kind === "image" && item.mimeType.startsWith("image/")) ||
			(item.kind === "video" && item.mimeType.startsWith("video/")),
		{ error: "Saved-set media kind and MIME type do not match" },
	);

export const albumPresetManifestSchema = z
	.object({
		version: z.literal(1),
		presetId: z.uuid(),
		name: z.string().trim().min(1).max(120),
		createdAt: z.int().nonnegative(),
		updatedAt: z.int().nonnegative(),
		items: z.array(albumPresetItemSchema),
	})
	.strict()
	.refine(
		(manifest) =>
			new Set(manifest.items.map((item) => item.itemId)).size ===
			manifest.items.length,
		{ error: "Saved-set item ids must be unique" },
	)
	.refine(
		(manifest) =>
			manifest.items.every(
				(item, index) =>
					item.order === index && manifest.items[index]?.order === index,
			),
		{ error: "Saved-set item order must be contiguous and unique" },
	);

export type AlbumPresetManifest = z.infer<typeof albumPresetManifestSchema>;
export type AlbumPresetItem = z.infer<typeof albumPresetItemSchema>;

export type LiveAlbumActivationItem = {
	contentId: number;
	checksum: string;
	kind: "image" | "video";
	order: number;
};

export type AlbumActivationAction = {
	id: string;
	kind: "retain" | "upload" | "delete" | "reorder" | "verify";
	itemId?: string;
	contentId?: number;
	expectedBefore: string[];
	expectedAfter: string[];
};

export type AlbumActivationPlan = {
	version: 1;
	presetId: string;
	desiredChecksums: string[];
	actions: AlbumActivationAction[];
	retainedContentIds: number[];
};

export type AlbumActivationJournal = {
	version: 1;
	journalId: string;
	presetId: string;
	targetAlbumId: number;
	status: "active" | "cancelled" | "conflict" | "completed";
	plan: AlbumActivationPlan;
	completedActionIds: string[];
	createdAt: number;
	updatedAt: number;
	rollbackPromised?: false;
	recoveryPresetId?: string;
	contentChecksums?: Record<string, string>;
	shareProfileIds?: number[];
};

export const albumActivationJournalSchema: z.ZodType<AlbumActivationJournal> = z
	.object({
		version: z.literal(1),
		journalId: z.uuid(),
		presetId: z.uuid(),
		targetAlbumId: z.int().nonnegative(),
		status: z.enum(["active", "cancelled", "conflict", "completed"]),
		plan: z
			.object({
				version: z.literal(1),
				presetId: z.uuid(),
				desiredChecksums: z.array(sha256Schema),
				actions: z.array(
					z
						.object({
							id: z.string().min(1).max(64),
							kind: z.enum(["retain", "upload", "delete", "reorder", "verify"]),
							itemId: z.uuid().optional(),
							contentId: z.int().nonnegative().optional(),
							expectedBefore: z.array(sha256Schema),
							expectedAfter: z.array(sha256Schema),
						})
						.strict(),
				),
				retainedContentIds: z.array(z.int().nonnegative()),
			})
			.strict(),
		completedActionIds: z.array(z.string().min(1).max(64)),
		createdAt: z.int().nonnegative(),
		updatedAt: z.int().nonnegative(),
		rollbackPromised: z.literal(false).optional(),
		recoveryPresetId: z.uuid().optional(),
		contentChecksums: z.record(z.string(), sha256Schema).optional(),
		shareProfileIds: z.array(z.int().nonnegative()).optional(),
	})
	.strict();

function sameSequence(left: readonly string[], right: readonly string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function action(
	index: number,
	kind: AlbumActivationAction["kind"],
	expectedBefore: string[],
	expectedAfter: string[],
	reference: Pick<AlbumActivationAction, "itemId" | "contentId"> = {},
): AlbumActivationAction {
	return {
		id: `${String(index).padStart(3, "0")}:${kind}`,
		kind,
		expectedBefore: [...expectedBefore],
		expectedAfter: [...expectedAfter],
		...reference,
	};
}

/**
 * Produces a capacity-safe, share-preserving reconciliation plan. The plan is
 * deliberately closed: there is no action capable of changing an album's
 * share list.
 */
export function buildAlbumActivationPlan({
	desired,
	live,
	limits,
}: {
	desired: AlbumPresetManifest;
	live: LiveAlbumActivationItem[];
	limits: { maxItems: number; maxVideos: number };
}): AlbumActivationPlan {
	const parsed = albumPresetManifestSchema.parse(desired);
	if (parsed.items.length > limits.maxItems) {
		throw new Error(
			`Saved set has ${parsed.items.length} items, exceeding the current ${limits.maxItems}-item limit`,
		);
	}
	const videos = parsed.items.filter((item) => item.kind === "video").length;
	if (videos > limits.maxVideos) {
		throw new Error(
			`Saved set has ${videos} videos, exceeding the current ${limits.maxVideos}-video limit`,
		);
	}

	const desiredItems = parsed.items.toSorted((a, b) => a.order - b.order);
	const unmatchedLive = [...live].toSorted((a, b) => a.order - b.order);
	const matches = new Map<string, LiveAlbumActivationItem>();
	for (const item of desiredItems) {
		const index = unmatchedLive.findIndex(
			(candidate) =>
				candidate.checksum === item.checksum && candidate.kind === item.kind,
		);
		if (index >= 0)
			matches.set(item.itemId, unmatchedLive.splice(index, 1)[0]!);
	}

	let state = live
		.toSorted((a, b) => a.order - b.order)
		.map((item) => item.checksum);
	const actions: AlbumActivationAction[] = [];
	const add = (
		kind: AlbumActivationAction["kind"],
		next: string[],
		reference?: Pick<AlbumActivationAction, "itemId" | "contentId">,
	) => {
		actions.push(action(actions.length, kind, state, next, reference));
		state = next;
	};

	for (const item of desiredItems) {
		const match = matches.get(item.itemId);
		if (match)
			add("retain", [...state], {
				itemId: item.itemId,
				contentId: match.contentId,
			});
	}

	const pending = desiredItems.filter((item) => !matches.has(item.itemId));
	while (pending.length > 0 && state.length < limits.maxItems) {
		const item = pending.shift()!;
		add("upload", [...state, item.checksum], { itemId: item.itemId });
	}

	for (const obsolete of unmatchedLive) {
		const index = state.indexOf(obsolete.checksum);
		const next = [...state];
		if (index >= 0) next.splice(index, 1);
		add("delete", next, { contentId: obsolete.contentId });
		if (pending.length > 0) {
			const item = pending.shift()!;
			add("upload", [...state, item.checksum], { itemId: item.itemId });
		}
	}

	if (pending.length > 0) {
		throw new Error(
			"Could not construct a capacity-safe album activation plan",
		);
	}
	const desiredChecksums = desiredItems.map((item) => item.checksum);
	add("reorder", desiredChecksums);
	add("verify", desiredChecksums);

	return {
		version: 1,
		presetId: parsed.presetId,
		desiredChecksums,
		actions,
		retainedContentIds: [...matches.values()].map((item) => item.contentId),
	};
}

type AlbumActivationDependencies = {
	inspect(targetAlbumId: number): Promise<string[]>;
	execute(targetAlbumId: number, action: AlbumActivationAction): Promise<void>;
	saveJournal(journal: AlbumActivationJournal): Promise<void>;
	now?: () => number;
};

/**
 * Runs one encrypted journal to completion. Each step is inspected before and
 * after execution so a restart can mark already-applied work complete while a
 * conflicting external edit stops the run without choosing destructively.
 */
export class AlbumActivationCoordinator {
	readonly #dependencies: AlbumActivationDependencies;

	constructor(dependencies: AlbumActivationDependencies) {
		this.#dependencies = dependencies;
	}

	async resume(
		journal: AlbumActivationJournal,
	): Promise<AlbumActivationJournal> {
		if (journal.status !== "active") return journal;
		let current = {
			...journal,
			completedActionIds: [...journal.completedActionIds],
		};
		const completed = new Set(current.completedActionIds);
		const lastCompleted = current.plan.actions.findLast((item) =>
			completed.has(item.id),
		);
		if (lastCompleted) {
			const observed = await this.#dependencies.inspect(current.targetAlbumId);
			if (!sameSequence(observed, lastCompleted.expectedAfter)) {
				return await this.#persist({ ...current, status: "conflict" });
			}
		}

		for (const next of current.plan.actions) {
			if (completed.has(next.id)) continue;
			const before = await this.#dependencies.inspect(current.targetAlbumId);
			if (sameSequence(before, next.expectedAfter)) {
				completed.add(next.id);
				current = await this.#persist({
					...current,
					completedActionIds: [...completed],
				});
				continue;
			}
			if (!sameSequence(before, next.expectedBefore)) {
				return await this.#persist({ ...current, status: "conflict" });
			}
			await this.#dependencies.execute(current.targetAlbumId, next);
			const after = await this.#dependencies.inspect(current.targetAlbumId);
			if (!sameSequence(after, next.expectedAfter)) {
				return await this.#persist({ ...current, status: "conflict" });
			}
			completed.add(next.id);
			current = await this.#persist({
				...current,
				completedActionIds: [...completed],
			});
		}
		return await this.#persist({ ...current, status: "completed" });
	}

	async cancel(
		journal: AlbumActivationJournal,
	): Promise<AlbumActivationJournal> {
		if (journal.status !== "active") return journal;
		return await this.#persist({
			...journal,
			status: "cancelled",
			rollbackPromised: false,
		});
	}

	async #persist(
		journal: AlbumActivationJournal,
	): Promise<AlbumActivationJournal> {
		const updated = {
			...journal,
			updatedAt: this.#dependencies.now?.() ?? Date.now(),
		};
		await this.#dependencies.saveJournal(updated);
		return updated;
	}
}
