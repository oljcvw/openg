import { decode, encode } from "@msgpack/msgpack";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultFilters } from "$lib/components/filters/filters";

const {
	existsAppDataFileMock,
	readAppDataFileMock,
	writeAppDataFileAtomicMock,
} = vi.hoisted(() => ({
	existsAppDataFileMock: vi.fn(),
	readAppDataFileMock: vi.fn(),
	writeAppDataFileAtomicMock: vi.fn(),
}));

vi.mock(".", () => ({
	existsAppDataFile: existsAppDataFileMock,
	readAppDataFile: readAppDataFileMock,
	writeAppDataFileAtomic: writeAppDataFileAtomicMock,
}));

beforeEach(() => {
	vi.resetModules();
	existsAppDataFileMock.mockReset().mockResolvedValue(false);
	readAppDataFileMock.mockReset();
	writeAppDataFileAtomicMock.mockReset().mockResolvedValue(undefined);
});

describe("developer preference writes", () => {
	it("atomically rewrites a beta-4 preference payload in canonical beta-5 form", async () => {
		existsAppDataFileMock.mockResolvedValue(true);
		readAppDataFileMock.mockResolvedValue(
			encode({
				keepUnavailableCachedAlbums: false,
				developerSettings: { shortVideoCacheMb: 125 },
			}),
		);
		const { getPreferences } = await import("./preferences.svelte");

		const migrated = await getPreferences();
		expect(migrated.storageVersion).toBe(2);
		expect(migrated.keepUnavailableCachedAlbums).toBe(false);
		expect(migrated.retainSharedChatMedia).toBe(true);
		expect(migrated.developerSettings.directMediaCacheMb).toBe(125);
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledOnce();
		const persisted = decode(writeAppDataFileAtomicMock.mock.calls[0][1]);
		expect(persisted).toMatchObject({
			storageVersion: 2,
			keepUnavailableCachedAlbums: false,
			retainSharedChatMedia: true,
			developerSettings: { directMediaCacheMb: 125 },
		});
		expect(
			(persisted as { developerSettings: object }).developerSettings,
		).not.toHaveProperty("shortVideoCacheMb");
	}, 15_000);

	it("merges concurrent partial updates inside the write queue", async () => {
		const { getDeveloperSettingsSnapshot, setDeveloperSettings } =
			await import("./preferences.svelte");

		await Promise.all([
			setDeveloperSettings({ profileResolutionBatchSize: 7 }),
			setDeveloperSettings({ profileResolutionWindowMs: 125 }),
		]);

		expect(getDeveloperSettingsSnapshot()).toMatchObject({
			profileResolutionBatchSize: 7,
			profileResolutionWindowMs: 125,
		});
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledTimes(2);
	});

	it("persists Inbox appearance preferences without dropping other state", async () => {
		const {
			getInboxLayoutModeSnapshot,
			getInboxRowDensitySnapshot,
			setPreferences,
		} = await import("./preferences.svelte");

		await setPreferences({
			inboxLayoutMode: "stacked",
			inboxRowDensity: "roomy",
		});

		expect(getInboxLayoutModeSnapshot()).toBe("stacked");
		expect(getInboxRowDensitySnapshot()).toBe("roomy");
		const persisted = decode(writeAppDataFileAtomicMock.mock.calls[0][1]);
		expect(persisted).toMatchObject({
			inboxLayoutMode: "stacked",
			inboxRowDensity: "roomy",
			contrastMode: "standard",
		});
	});

	it("updates the age scale and clamps the persisted Browse selection atomically", async () => {
		const {
			getDeveloperSettingsSnapshot,
			getPreferences,
			setBrowseAgeScale,
			setPreferences,
		} = await import("./preferences.svelte");
		await setPreferences({
			gridSearchFilters: {
				...defaultFilters,
				ageEnabled: true,
				age: [20, 80],
			},
		});

		const result = await setBrowseAgeScale({ min: 25, max: 55 });

		expect(result).toMatchObject({
			ageSelectionClamped: true,
			previousAge: [20, 80],
			nextAge: [25, 55],
			scale: { min: 25, max: 55 },
		});
		expect(result.gridSearchFilters).toMatchObject({
			ageEnabled: true,
			age: [25, 55],
		});
		expect(getDeveloperSettingsSnapshot()).toMatchObject({
			browseAgeScaleMin: 25,
			browseAgeScaleMax: 55,
		});
		expect((await getPreferences()).gridSearchFilters).toMatchObject({
			ageEnabled: true,
			age: [25, 55],
		});
		expect(writeAppDataFileAtomicMock).toHaveBeenCalledTimes(2);
	});

	it("rejects age scale updates through the generic developer setter", async () => {
		const { setDeveloperSettings } = await import("./preferences.svelte");

		await expect(
			setDeveloperSettings({ browseAgeScaleMin: 30 } as never),
		).rejects.toThrow("dedicated atomic setter");
		expect(writeAppDataFileAtomicMock).not.toHaveBeenCalled();
	});
});
