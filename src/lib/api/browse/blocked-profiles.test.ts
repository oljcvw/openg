import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBlockedUsersMock, getProfilesMock } = vi.hoisted(() => ({
	getBlockedUsersMock: vi.fn(),
	getProfilesMock: vi.fn(),
}));

vi.mock("$lib/api/browse/blocks", () => ({
	getBlockedUsers: getBlockedUsersMock,
}));

vi.mock("$lib/api/users/profiles", () => ({
	getProfiles: getProfilesMock,
}));

import { getBlockedProfiles } from "$lib/api/browse/blocked-profiles";

function profileSummary({
	profileId,
	displayName,
	profileImageMediaHash = null,
	mediaHash = null,
}: {
	profileId: number;
	displayName: string | null;
	profileImageMediaHash?: string | null;
	mediaHash?: string | null;
}) {
	return {
		profileId,
		displayName,
		profileImageMediaHash,
		medias: mediaHash === null ? [] : [{ mediaHash }],
	};
}

describe("getBlockedProfiles", () => {
	beforeEach(() => {
		getBlockedUsersMock.mockReset();
		getProfilesMock.mockReset();
	});

	it("keeps block-list order while adding display names and primary thumbnails", async () => {
		getBlockedUsersMock.mockResolvedValue([
			{ profileId: 12, blockedTime: 1200 },
			{ profileId: 11, blockedTime: 1100 },
			{ profileId: 13, blockedTime: 1300 },
		]);
		getProfilesMock.mockResolvedValue([
			profileSummary({
				profileId: 11,
				displayName: "Eleven",
				profileImageMediaHash: "primary-eleven",
				mediaHash: "first-eleven",
			}),
			profileSummary({
				profileId: 12,
				displayName: "Twelve",
				mediaHash: "first-twelve",
			}),
		]);

		await expect(getBlockedProfiles()).resolves.toEqual([
			{
				profileId: 12,
				blockedTime: 1200,
				displayName: "Twelve",
				mediaHash: "first-twelve",
			},
			{
				profileId: 11,
				blockedTime: 1100,
				displayName: "Eleven",
				mediaHash: "primary-eleven",
			},
			{
				profileId: 13,
				blockedTime: 1300,
				displayName: null,
				mediaHash: null,
			},
		]);
	});

	it("limits each profile-summary request to the API maximum", async () => {
		const blocked = Array.from({ length: 151 }, (_, index) => ({
			profileId: index + 1,
			blockedTime: 0,
		}));
		getBlockedUsersMock.mockResolvedValue(blocked);
		getProfilesMock.mockResolvedValue([]);

		const result = await getBlockedProfiles();

		expect(result).toHaveLength(151);
		expect(getProfilesMock.mock.calls).toEqual([
			[blocked.slice(0, 150).map(({ profileId }) => profileId)],
			[[151]],
		]);
	});

	it("keeps every unblock target when one enrichment batch fails", async () => {
		const blocked = Array.from({ length: 151 }, (_, index) => ({
			profileId: index + 1,
			blockedTime: 0,
		}));
		getBlockedUsersMock.mockResolvedValue(blocked);
		getProfilesMock
			.mockRejectedValueOnce(new Error("summary lookup failed"))
			.mockResolvedValueOnce([
				profileSummary({
					profileId: 151,
					displayName: "Last profile",
					mediaHash: "last-photo",
				}),
			]);

		const result = await getBlockedProfiles();

		expect(result[0]).toEqual({
			profileId: 1,
			blockedTime: 0,
			displayName: null,
			mediaHash: null,
		});
		expect(result[150]).toEqual({
			profileId: 151,
			blockedTime: 0,
			displayName: "Last profile",
			mediaHash: "last-photo",
		});
	});
});
