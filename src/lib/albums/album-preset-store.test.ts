import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearAlbumPresets,
	importAlbumPreset,
	listAlbumPresets,
	readAlbumPresetItem,
} from "./album-preset-store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("album preset native store", () => {
	beforeEach(() => invokeMock.mockReset());

	it("imports only media bytes and bounded metadata, never a source URL", async () => {
		invokeMock.mockResolvedValue({
			version: 1,
			presetId: "11111111-1111-4111-8111-111111111111",
			name: "Local set",
			createdAt: 1,
			updatedAt: 1,
			items: [
				{
					itemId: "22222222-2222-4222-8222-222222222222",
					kind: "image",
					mimeType: "image/jpeg",
					byteLength: 3,
					checksum: "a".repeat(64),
					width: null,
					height: null,
					durationMs: null,
					order: 0,
				},
			],
		});

		await importAlbumPreset({
			accountId: 7,
			presetId: "11111111-1111-4111-8111-111111111111",
			name: "Local set",
			items: [
				{
					itemId: "22222222-2222-4222-8222-222222222222",
					kind: "image",
					mimeType: "image/jpeg",
					bytes: new Uint8Array([1, 2, 3]),
					width: null,
					height: null,
					durationMs: null,
				},
			],
		});

		expect(invokeMock).toHaveBeenCalledWith("album_preset_import", {
			accountId: "7",
			presetId: "11111111-1111-4111-8111-111111111111",
			name: "Local set",
			items: [expect.objectContaining({ data: "AQID" })],
		});
		expect(JSON.stringify(invokeMock.mock.calls[0])).not.toContain("url");
	});

	it("validates list/read responses and clears one account only", async () => {
		invokeMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({
				data: "AQID",
				mimeType: "image/jpeg",
				byteLength: 3,
			})
			.mockResolvedValueOnce(undefined);
		expect(await listAlbumPresets(7)).toEqual([]);
		expect(
			await readAlbumPresetItem(
				7,
				"11111111-1111-4111-8111-111111111111",
				"22222222-2222-4222-8222-222222222222",
			),
		).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" });
		await clearAlbumPresets(7);
		expect(invokeMock).toHaveBeenLastCalledWith("album_preset_clear", {
			accountId: "7",
		});
	});
});
