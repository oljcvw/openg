import { decode, encode } from "@msgpack/msgpack";
import z from "zod";

import { registerAccountCache } from "$lib/api/account-caches";
import { existsAppDataFile, readAppDataFile, writeAppDataFileAtomic } from ".";

const savedPhraseSchema = z.object({
	id: z.uuid(),
	text: z.string().min(1),
});

const savedPhrasesSchema = z.object({
	version: z.literal(1).default(1),
	accounts: z.record(z.string(), z.array(savedPhraseSchema)).default({}),
});

export type SavedPhrase = z.infer<typeof savedPhraseSchema>;
type SavedPhrases = z.infer<typeof savedPhrasesSchema>;

const FILE_NAME = "saved-phrases.data";

let cache: SavedPhrases | null = null;
let hydrating: Promise<SavedPhrases> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
let cacheGeneration = 0;
const listeners = new Map<number, Set<() => void>>();

export class DuplicateSavedPhraseError extends Error {
	constructor() {
		super("This phrase is already saved.");
		this.name = "DuplicateSavedPhraseError";
	}
}

export function parseSavedPhrases(value: unknown): SavedPhrases {
	return savedPhrasesSchema.parse(value);
}

export function removeAccountSavedPhrases(
	value: unknown,
	accountProfileId: number,
): SavedPhrases {
	const phrases = structuredClone(parseSavedPhrases(value));
	delete phrases.accounts[accountKey(accountProfileId)];
	return parseSavedPhrases(phrases);
}

function accountKey(profileId: number): string {
	return String(profileId);
}

function prepareText(value: string): string {
	const text = value.trim().normalize("NFC");
	if (text === "") throw new Error("Saved phrases cannot be empty.");
	return text;
}

function duplicateKey(value: string): string {
	return value.normalize("NFC").toLowerCase();
}

function assertUnique(
	phrases: SavedPhrase[],
	text: string,
	excludedId?: string,
): void {
	const key = duplicateKey(text);
	if (
		phrases.some(
			(phrase) => phrase.id !== excludedId && duplicateKey(phrase.text) === key,
		)
	) {
		throw new DuplicateSavedPhraseError();
	}
}

async function readFromDisk(): Promise<SavedPhrases> {
	if (!(await existsAppDataFile(FILE_NAME))) return parseSavedPhrases({});
	return parseSavedPhrases(decode(await readAppDataFile(FILE_NAME)));
}

async function getSavedPhrases(): Promise<SavedPhrases> {
	if (cache !== null) return cache;
	const generation = cacheGeneration;
	hydrating ??= readFromDisk()
		.then((phrases) => {
			if (generation === cacheGeneration) cache = phrases;
			return phrases;
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

async function persist(
	generation: number,
	phrases: SavedPhrases,
): Promise<void> {
	const validated = parseSavedPhrases(phrases);
	await writeAppDataFileAtomic(FILE_NAME, encode(validated));
	if (generation === cacheGeneration) cache = validated;
}

function notify(accountProfileId: number): void {
	for (const listener of listeners.get(accountProfileId) ?? []) listener();
}

export function subscribeSavedPhrases(
	accountProfileId: number,
	listener: () => void,
): () => void {
	const accountListeners = listeners.get(accountProfileId) ?? new Set();
	accountListeners.add(listener);
	listeners.set(accountProfileId, accountListeners);
	return () => {
		accountListeners.delete(listener);
		if (accountListeners.size === 0) listeners.delete(accountProfileId);
	};
}

export function filterSavedPhrases(
	phrases: readonly SavedPhrase[],
	query: string,
): SavedPhrase[] {
	const normalizedQuery = query.trimStart().normalize("NFC").toLowerCase();
	return phrases.filter((phrase) =>
		phrase.text.normalize("NFC").toLowerCase().startsWith(normalizedQuery),
	);
}

export async function listSavedPhrases(
	accountProfileId: number,
): Promise<SavedPhrase[]> {
	const phrases = await getSavedPhrases();
	return structuredClone(phrases.accounts[accountKey(accountProfileId)] ?? []);
}

export async function addSavedPhrase(
	accountProfileId: number,
	value: string,
): Promise<SavedPhrase> {
	const text = prepareText(value);
	return await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getSavedPhrases();
		const phrases = structuredClone(current);
		const ownerKey = accountKey(accountProfileId);
		const accountPhrases = [...(phrases.accounts[ownerKey] ?? [])];
		assertUnique(accountPhrases, text);
		const phrase = savedPhraseSchema.parse({ id: crypto.randomUUID(), text });
		accountPhrases.push(phrase);
		phrases.accounts[ownerKey] = accountPhrases;
		await persist(generation, phrases);
		notify(accountProfileId);
		return structuredClone(phrase);
	});
}

export async function updateSavedPhrase(
	accountProfileId: number,
	phraseId: string,
	value: string,
): Promise<SavedPhrase[]> {
	const text = prepareText(value);
	return await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getSavedPhrases();
		const phrases = structuredClone(current);
		const ownerKey = accountKey(accountProfileId);
		const accountPhrases = [...(phrases.accounts[ownerKey] ?? [])];
		const index = accountPhrases.findIndex((phrase) => phrase.id === phraseId);
		if (index < 0) throw new Error("Saved phrase not found.");
		assertUnique(accountPhrases, text, phraseId);
		accountPhrases[index] = savedPhraseSchema.parse({ id: phraseId, text });
		phrases.accounts[ownerKey] = accountPhrases;
		await persist(generation, phrases);
		notify(accountProfileId);
		return structuredClone(accountPhrases);
	});
}

export async function deleteSavedPhrase(
	accountProfileId: number,
	phraseId: string,
): Promise<SavedPhrase[]> {
	return await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getSavedPhrases();
		const phrases = structuredClone(current);
		const ownerKey = accountKey(accountProfileId);
		const accountPhrases = phrases.accounts[ownerKey] ?? [];
		const remaining = accountPhrases.filter((phrase) => phrase.id !== phraseId);
		if (remaining.length === accountPhrases.length) {
			throw new Error("Saved phrase not found.");
		}
		if (remaining.length === 0) delete phrases.accounts[ownerKey];
		else phrases.accounts[ownerKey] = remaining;
		await persist(generation, phrases);
		notify(accountProfileId);
		return structuredClone(remaining);
	});
}

export async function moveSavedPhrase(
	accountProfileId: number,
	phraseId: string,
	destinationIndex: number,
): Promise<SavedPhrase[]> {
	return await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getSavedPhrases();
		const phrases = structuredClone(current);
		const ownerKey = accountKey(accountProfileId);
		const accountPhrases = [...(phrases.accounts[ownerKey] ?? [])];
		const sourceIndex = accountPhrases.findIndex(
			(phrase) => phrase.id === phraseId,
		);
		if (sourceIndex < 0) throw new Error("Saved phrase not found.");
		if (
			!Number.isInteger(destinationIndex) ||
			destinationIndex < 0 ||
			destinationIndex >= accountPhrases.length
		) {
			throw new RangeError("Saved phrase destination is out of range.");
		}
		const [phrase] = accountPhrases.splice(sourceIndex, 1);
		accountPhrases.splice(destinationIndex, 0, phrase);
		phrases.accounts[ownerKey] = accountPhrases;
		await persist(generation, phrases);
		notify(accountProfileId);
		return structuredClone(accountPhrases);
	});
}

export async function clearSavedPhrases(
	accountProfileId: number,
): Promise<void> {
	await deleteSavedPhrasesForAccount(accountProfileId);
}

export async function deleteSavedPhrasesForAccount(
	accountProfileId: number,
): Promise<void> {
	await enqueueWrite(async () => {
		const generation = cacheGeneration;
		const current = await getSavedPhrases();
		await persist(
			generation,
			removeAccountSavedPhrases(current, accountProfileId),
		);
		notify(accountProfileId);
	});
}

export function clearSavedPhrasesCache(): void {
	cacheGeneration += 1;
	cache = null;
	hydrating = null;
}

registerAccountCache(clearSavedPhrasesCache);
