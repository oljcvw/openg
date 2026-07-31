import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { existsAppDataFile, readAppDataFile, writeAppDataFileAtomic } from ".";

export const FAVORITE_NOTE_MAX_LENGTH = 280;

export const favoriteNoteSchema = z
	.string()
	.refine(
		(value) => Array.from(value).length <= FAVORITE_NOTE_MAX_LENGTH,
		`Notes can be at most ${FAVORITE_NOTE_MAX_LENGTH} characters`,
	);

const favoriteNotesSchema = z.object({
	version: z.literal(1).default(1),
	accounts: z
		.record(z.string(), z.record(z.string(), favoriteNoteSchema))
		.default({}),
});

type FavoriteNotes = z.infer<typeof favoriteNotesSchema>;

const FILE_NAME = "favorite-notes.data";

let cache: FavoriteNotes | null = null;
let hydrating: Promise<FavoriteNotes> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let cacheGeneration = 0;

export function parseFavoriteNotes(value: unknown): FavoriteNotes {
	return favoriteNotesSchema.parse(value);
}

export function favoriteNoteLength(value: string): number {
	return Array.from(value).length;
}

function accountKey(profileId: number): string {
	return String(profileId);
}

async function readFromDisk(): Promise<FavoriteNotes> {
	if (!(await existsAppDataFile(FILE_NAME))) return parseFavoriteNotes({});
	return parseFavoriteNotes(decode(await readAppDataFile(FILE_NAME)));
}

async function getFavoriteNotes(): Promise<FavoriteNotes> {
	if (cache !== null) return cache;
	const generation = cacheGeneration;
	hydrating ??= readFromDisk()
		.then((notes) => {
			if (generation === cacheGeneration) cache = notes;
			return notes;
		})
		.finally(() => {
			if (generation === cacheGeneration) hydrating = null;
		});
	return await hydrating;
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = writeQueue.then(task);
	writeQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

export async function getFavoriteNote(
	accountProfileId: number,
	subjectProfileId: number,
): Promise<string> {
	const notes = await getFavoriteNotes();
	return (
		notes.accounts[accountKey(accountProfileId)]?.[
			accountKey(subjectProfileId)
		] ?? ""
	);
}

export async function setFavoriteNote(
	accountProfileId: number,
	subjectProfileId: number,
	value: string,
): Promise<void> {
	const note = value.trim();
	favoriteNoteSchema.parse(note);

	await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getFavoriteNotes();
		const notes = structuredClone(current);
		const ownerKey = accountKey(accountProfileId);
		const subjectKey = accountKey(subjectProfileId);
		const accountNotes = { ...(notes.accounts[ownerKey] ?? {}) };

		if (note === "") {
			delete accountNotes[subjectKey];
		} else {
			accountNotes[subjectKey] = note;
		}

		if (Object.keys(accountNotes).length === 0) {
			delete notes.accounts[ownerKey];
		} else {
			notes.accounts[ownerKey] = accountNotes;
		}

		const validated = parseFavoriteNotes(notes);
		await writeAppDataFileAtomic(FILE_NAME, encode(validated));
		if (generation === cacheGeneration) cache = validated;
	});
}

export function clearFavoriteNotesCache(): void {
	cacheGeneration += 1;
	cache = null;
	hydrating = null;
}

registerAccountCache(clearFavoriteNotesCache);
