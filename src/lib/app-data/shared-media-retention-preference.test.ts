import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearDirectMock, clearShortMock, setPreferencesMock } = vi.hoisted(
	() => ({
		clearDirectMock: vi.fn().mockResolvedValue(undefined),
		clearShortMock: vi.fn().mockResolvedValue(undefined),
		setPreferencesMock: vi.fn().mockResolvedValue(undefined),
	}),
);

vi.mock("$lib/app-data/direct-media-cache", () => ({
	clearDirectMediaCache: clearDirectMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	setPreferences: setPreferencesMock,
}));
vi.mock("$lib/app-data/short-video-cache", () => ({
	clearShortVideoCache: clearShortMock,
}));

import { setSharedMediaRetentionPreference } from "$lib/app-data/shared-media-retention-preference";

describe("shared-media retention preference", () => {
	beforeEach(() => {
		clearDirectMock.mockClear();
		clearShortMock.mockClear();
		setPreferencesMock.mockReset().mockResolvedValue(undefined);
	});

	it("globally clears retained media after disabling is persisted", async () => {
		let finishSave: (() => void) | undefined;
		setPreferencesMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finishSave = resolve;
			}),
		);
		const disabling = setSharedMediaRetentionPreference(false);
		expect(clearDirectMock).not.toHaveBeenCalled();
		finishSave?.();
		await disabling;

		expect(clearDirectMock).toHaveBeenCalledWith();
		expect(clearShortMock).toHaveBeenCalledWith();
	});

	it("does not clear caches when retention is enabled", async () => {
		await setSharedMediaRetentionPreference(true);
		expect(clearDirectMock).not.toHaveBeenCalled();
		expect(clearShortMock).not.toHaveBeenCalled();
	});
});
