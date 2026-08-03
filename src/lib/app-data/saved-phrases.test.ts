import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	addSavedPhrase,
	clearSavedPhrasesCache,
	deleteSavedPhrase,
	deleteSavedPhrasesForAccount,
	DuplicateSavedPhraseError,
	listSavedPhrases,
	moveSavedPhrase,
	parseSavedPhrases,
	removeAccountSavedPhrases,
	updateSavedPhrase,
} from "$lib/app-data/saved-phrases";

const {
	existsAppDataFileMock,
	readAppDataFileMock,
	writeAppDataFileAtomicMock,
} = vi.hoisted(() => ({
	existsAppDataFileMock: vi.fn(),
	readAppDataFileMock: vi.fn(),
	writeAppDataFileAtomicMock: vi.fn(),
}));

vi.mock("$lib/app-data", () => ({
	existsAppDataFile: existsAppDataFileMock,
	readAppDataFile: readAppDataFileMock,
	writeAppDataFileAtomic: writeAppDataFileAtomicMock,
}));

function latestWrite() {
	const call = writeAppDataFileAtomicMock.mock.calls.at(-1);
	expect(call?.[0]).toBe("saved-phrases.data");
	return parseSavedPhrases(decode(call?.[1] as Uint8Array));
}

describe("saved phrases persistence", () => {
	beforeEach(() => {
		clearSavedPhrasesCache();
		existsAppDataFileMock.mockReset().mockResolvedValue(false);
		readAppDataFileMock.mockReset();
		writeAppDataFileAtomicMock.mockReset().mockResolvedValue(undefined);
	});

	it("creates stable UUID phrases and preserves insertion order", async () => {
		const first = await addSavedPhrase(100, "  First phrase  ");
		const second = await addSavedPhrase(100, "Second phrase");

		expect(first.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(await listSavedPhrases(100)).toEqual([
			{ id: first.id, text: "First phrase" },
			{ id: second.id, text: "Second phrase" },
		]);
		expect(latestWrite().accounts["100"]).toHaveLength(2);
	});

	it("rejects empty and NFC case-insensitive duplicate phrases", async () => {
		await addSavedPhrase(100, "Caf\u00e9");

		await expect(addSavedPhrase(100, "  CAFE\u0301 ")).rejects.toBeInstanceOf(
			DuplicateSavedPhraseError,
		);
		await expect(addSavedPhrase(100, " \n ")).rejects.toThrow(
			"Saved phrases cannot be empty.",
		);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
	});

	it("updates, reorders, and deletes phrases without changing IDs", async () => {
		const first = await addSavedPhrase(100, "First");
		const second = await addSavedPhrase(100, "Second");
		await updateSavedPhrase(100, first.id, "Updated");
		await moveSavedPhrase(100, second.id, 0);

		expect(await deleteSavedPhrase(100, second.id)).toEqual([
			{ id: first.id, text: "Updated" },
		]);
	});

	it("hydrates MsgPack data and keeps accounts isolated", async () => {
		existsAppDataFileMock.mockResolvedValue(true);
		readAppDataFileMock.mockResolvedValue(
			encode({
				version: 1,
				accounts: {
					"100": [
						{
							id: "00000000-0000-4000-8000-000000000001",
							text: "Account one",
						},
					],
					"101": [
						{
							id: "00000000-0000-4000-8000-000000000002",
							text: "Account two",
						},
					],
				},
			}),
		);

		expect(await listSavedPhrases(100)).toHaveLength(1);
		expect(await listSavedPhrases(101)).toHaveLength(1);
		expect(readAppDataFileMock).toHaveBeenCalledOnce();
	});

	it("retains disk data when the account cache is cleared on sign-out", async () => {
		existsAppDataFileMock.mockResolvedValue(true);
		readAppDataFileMock.mockResolvedValue(
			encode({
				version: 1,
				accounts: {
					"100": [
						{
							id: "00000000-0000-4000-8000-000000000001",
							text: "Retained",
						},
					],
				},
			}),
		);

		expect(await listSavedPhrases(100)).toHaveLength(1);
		clearSavedPhrasesCache();
		expect(await listSavedPhrases(100)).toHaveLength(1);
		expect(readAppDataFileMock).toHaveBeenCalledTimes(2);
		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
	});

	it("deletes one account while preserving all other accounts", async () => {
		existsAppDataFileMock.mockResolvedValue(true);
		readAppDataFileMock.mockResolvedValue(
			encode({
				version: 1,
				accounts: {
					"100": [
						{
							id: "00000000-0000-4000-8000-000000000001",
							text: "Delete",
						},
					],
					"101": [
						{
							id: "00000000-0000-4000-8000-000000000002",
							text: "Keep",
						},
					],
				},
			}),
		);

		await deleteSavedPhrasesForAccount(100);

		expect(latestWrite().accounts["100"]).toBeUndefined();
		expect(latestWrite().accounts["101"]?.[0]?.text).toBe("Keep");
	});

	it("serializes concurrent writes without losing updates", async () => {
		const firstWrite = Promise.withResolvers<void>();
		writeAppDataFileAtomicMock.mockReturnValueOnce(firstWrite.promise);

		const first = addSavedPhrase(100, "First");
		const second = addSavedPhrase(100, "Second");
		await vi.waitFor(() =>
			expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce(),
		);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
		firstWrite.resolve();
		await Promise.all([first, second]);

		expect(writeAppDataFileAtomicMock).toHaveBeenCalledTimes(2);
		expect(latestWrite().accounts["100"]?.map((phrase) => phrase.text)).toEqual(
			["First", "Second"],
		);
	});

	it("provides a pure account-removal operation", () => {
		const result = removeAccountSavedPhrases(
			{
				version: 1,
				accounts: {
					"100": [],
					"101": [],
				},
			},
			100,
		);

		expect(result.accounts).toEqual({ "101": [] });
	});
});
