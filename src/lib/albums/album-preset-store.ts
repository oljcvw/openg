import { invoke } from "@tauri-apps/api/core";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { demoEnabled } from "$lib/demo/config";
import { fromBase64, toBase64 } from "$lib/util/base64";
import {
	type AlbumActivationJournal,
	albumActivationJournalSchema,
	type AlbumPresetManifest,
	albumPresetManifestSchema,
} from "./album-presets";

const readItemSchema = z.object({
	data: z.string(),
	mimeType: z.string(),
	byteLength: z.int().positive(),
});

const presetStatsSchema = z.object({
	presetCount: z.int().nonnegative(),
	byteLength: z.int().nonnegative(),
});

export type AlbumPresetImportItem = {
	itemId: string;
	kind: "image" | "video";
	mimeType: "image/jpeg" | "image/png" | "video/mp4" | "video/webm";
	bytes: Uint8Array;
	width: number | null;
	height: number | null;
	durationMs: number | null;
};

export type AlbumPresetRemoteImportItem = Omit<
	AlbumPresetImportItem,
	"bytes"
> & {
	sourceUrl: string;
	maximumBytes: number;
};

type DemoPreset = {
	manifest: AlbumPresetManifest;
	items: Map<string, { bytes: Uint8Array; mimeType: string }>;
};
const demoPresets = new Map<number, Map<string, DemoPreset>>();
const demoJournals = new Map<string, AlbumActivationJournal>();

function demoAccountPresets(accountId: number): Map<string, DemoPreset> {
	let presets = demoPresets.get(accountId);
	if (!presets) {
		presets = new Map();
		demoPresets.set(accountId, presets);
	}
	return presets;
}

async function checksum(bytes: Uint8Array): Promise<string> {
	const copy = Uint8Array.from(bytes);
	const digest = await crypto.subtle.digest("SHA-256", copy);
	return [...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

async function demoImport(
	accountId: number,
	presetId: string,
	name: string,
	items: AlbumPresetImportItem[],
): Promise<AlbumPresetManifest> {
	const now = Date.now();
	const manifest = albumPresetManifestSchema.parse({
		version: 1,
		presetId,
		name,
		createdAt: now,
		updatedAt: now,
		items: await Promise.all(
			items.map(async ({ bytes, ...item }, order) => ({
				...item,
				byteLength: bytes.byteLength,
				checksum: await checksum(bytes),
				order,
			})),
		),
	});
	demoAccountPresets(accountId).set(presetId, {
		manifest,
		items: new Map(
			items.map((item) => [
				item.itemId,
				{ bytes: Uint8Array.from(item.bytes), mimeType: item.mimeType },
			]),
		),
	});
	return manifest;
}

export async function importAlbumPreset({
	accountId,
	presetId,
	name,
	items,
}: {
	accountId: number;
	presetId: string;
	name: string;
	items: AlbumPresetImportItem[];
}): Promise<AlbumPresetManifest> {
	if (demoEnabled) return demoImport(accountId, presetId, name, items);
	const response = await invoke("album_preset_import", {
		accountId: String(accountId),
		presetId,
		name,
		items: items.map(({ bytes, ...item }) => ({
			...item,
			data: toBase64(bytes),
		})),
	});
	return albumPresetManifestSchema.parse(response);
}

export async function snapshotRemoteAlbumPreset({
	accountId,
	presetId,
	name,
	items,
}: {
	accountId: number;
	presetId: string;
	name: string;
	items: AlbumPresetRemoteImportItem[];
}): Promise<AlbumPresetManifest> {
	if (demoEnabled) {
		return demoImport(
			accountId,
			presetId,
			name,
			items.map((item) => ({
				itemId: item.itemId,
				kind: item.kind,
				mimeType: item.mimeType,
				bytes: new TextEncoder().encode(item.sourceUrl),
				width: item.width,
				height: item.height,
				durationMs: item.durationMs,
			})),
		);
	}
	const response = await invoke("album_preset_import_remote", {
		accountId: String(accountId),
		presetId,
		name,
		items,
	});
	return albumPresetManifestSchema.parse(response);
}

export async function listAlbumPresets(
	accountId: number,
): Promise<AlbumPresetManifest[]> {
	if (demoEnabled)
		return [...demoAccountPresets(accountId).values()]
			.map((preset) => preset.manifest)
			.toSorted((left, right) => right.updatedAt - left.updatedAt);
	return albumPresetManifestSchema
		.array()
		.parse(await invoke("album_preset_list", { accountId: String(accountId) }));
}

export async function readAlbumPresetItem(
	accountId: number,
	presetId: string,
	itemId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
	if (demoEnabled) {
		const item = demoAccountPresets(accountId).get(presetId)?.items.get(itemId);
		if (!item) throw new Error("Saved-set media is unavailable");
		return { bytes: Uint8Array.from(item.bytes), mimeType: item.mimeType };
	}
	const item = readItemSchema.parse(
		await invoke("album_preset_read_item", {
			accountId: String(accountId),
			presetId,
			itemId,
		}),
	);
	const bytes = fromBase64(item.data);
	if (bytes.byteLength !== item.byteLength)
		throw new Error("Saved-set media length did not match its manifest");
	return { bytes, mimeType: item.mimeType };
}

export async function deleteAlbumPreset(
	accountId: number,
	presetId: string,
): Promise<void> {
	if (demoEnabled) {
		demoAccountPresets(accountId).delete(presetId);
		return;
	}
	await invoke("album_preset_delete", {
		accountId: String(accountId),
		presetId,
	});
}

export async function getAlbumPresetStats(accountId: number) {
	if (demoEnabled) {
		const manifests = await listAlbumPresets(accountId);
		return {
			presetCount: manifests.length,
			byteLength: manifests
				.flatMap((manifest) => manifest.items)
				.reduce((total, item) => total + item.byteLength, 0),
		};
	}
	return presetStatsSchema.parse(
		await invoke("album_preset_stats", { accountId: String(accountId) }),
	);
}

export async function clearAlbumPresets(accountId?: number): Promise<void> {
	if (demoEnabled) {
		if (accountId === undefined) {
			demoPresets.clear();
			demoJournals.clear();
		} else {
			demoPresets.delete(accountId);
			for (const key of demoJournals.keys())
				if (key.startsWith(`${accountId}:`)) demoJournals.delete(key);
		}
		return;
	}
	await invoke("album_preset_clear", {
		accountId: accountId === undefined ? null : String(accountId),
	});
}

export async function saveAlbumActivationJournal(
	accountId: number,
	journal: AlbumActivationJournal,
): Promise<void> {
	const parsed = albumActivationJournalSchema.parse(journal);
	if (demoEnabled) {
		demoJournals.set(`${accountId}:${parsed.targetAlbumId}`, parsed);
		return;
	}
	await invoke("album_activation_journal_save", {
		accountId: String(accountId),
		targetAlbumId: String(parsed.targetAlbumId),
		journal: parsed,
	});
}

export async function readAlbumActivationJournal(
	accountId: number,
	targetAlbumId: number,
): Promise<AlbumActivationJournal | null> {
	if (demoEnabled)
		return demoJournals.get(`${accountId}:${targetAlbumId}`) ?? null;
	const response = await invoke<AlbumActivationJournal | null>(
		"album_activation_journal_read",
		{
			accountId: String(accountId),
			targetAlbumId: String(targetAlbumId),
		},
	);
	return response === null
		? null
		: albumActivationJournalSchema.parse(response);
}

registerAccountCache(() => {
	demoPresets.clear();
	demoJournals.clear();
});
