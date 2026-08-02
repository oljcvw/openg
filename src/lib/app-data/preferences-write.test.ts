import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
