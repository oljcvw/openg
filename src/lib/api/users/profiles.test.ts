import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	fetchRestMock,
	getDeveloperSettingsSnapshotMock,
	readCachedProfileEntryMock,
	removeCachedProfileMock,
	writeCachedProfileMock,
} = vi.hoisted(() => ({
	fetchRestMock:
		vi.fn<
			(path: string, options?: { method?: string; body?: unknown }) => unknown
		>(),
	getDeveloperSettingsSnapshotMock: vi.fn(() => ({
		profileResolutionBatchSize: 30,
	})),
	readCachedProfileEntryMock: vi.fn(),
	removeCachedProfileMock: vi.fn(),
	writeCachedProfileMock: vi.fn(),
}));

vi.mock("$lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api")>()),
	fetchRest: fetchRestMock,
}));
vi.mock("$lib/app-data/profile-cache", () => ({
	readCachedProfileEntry: readCachedProfileEntryMock,
	removeCachedProfile: removeCachedProfileMock,
	writeCachedProfile: writeCachedProfileMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: getDeveloperSettingsSnapshotMock,
}));

import { activateAccountSession } from "$lib/api/account-caches";
import {
	applyProfileEdit,
	clearProfileCaches,
	deleteProfilePhotos,
	getMyProfile,
	getPersistedProfile,
	getProfile,
	getProfiles,
	noteProfileFreshness,
	patchOwnProfile,
	ProfileModerationError,
	type ProfileUpdate,
	updateOwnProfile,
} from "$lib/api/users/profiles";
import { resetNowForTesting, setNowForTesting } from "$lib/util/clock";
import type { Profile } from "$lib/model/users/profiles";

const PROFILE_ID = 123;

function ok(data: unknown) {
	return {
		status: 200,
		assertOk() {},
		json: () => data,
		jsonParsed: () => data,
		text: () => (data == null ? "" : JSON.stringify(data)),
	};
}

function okRaw(text: string, status = 200) {
	return {
		status,
		assertOk() {
			if (status < 200 || status >= 300) {
				throw new Error(`API request failed with status ${status}`);
			}
		},
		text: () => text,
	};
}

function httpError(status: number, body: unknown) {
	return {
		status,
		assertOk() {
			throw new Error(`API request failed with status ${status}`);
		},
		text: () => (typeof body === "string" ? body : JSON.stringify(body)),
	};
}

function update(patch: Partial<ProfileUpdate> = {}): ProfileUpdate {
	return {
		approximateDistance: false,
		profileTags: [],
		...patch,
	};
}

function fullProfile() {
	return {
		profileId: PROFILE_ID,
		age: 25,
		socialNetworks: {
			twitter: { userId: "tw" },
			facebook: { userId: "fb" },
		},
		medias: [{ mediaHash: "a" }, { mediaHash: "b" }],
		lastUpdatedTime: 1_000,
	};
}

function shortProfile() {
	return {
		profileId: PROFILE_ID,
		showDistance: false,
		medias: [{ mediaHash: "a" }, { mediaHash: "b" }],
	};
}

beforeEach(() => {
	activateAccountSession(1);
	clearProfileCaches();
	fetchRestMock.mockReset();
	readCachedProfileEntryMock.mockReset().mockResolvedValue(null);
	removeCachedProfileMock.mockReset().mockResolvedValue(undefined);
	writeCachedProfileMock.mockReset().mockResolvedValue(undefined);
	getDeveloperSettingsSnapshotMock.mockClear();
	fetchRestMock.mockImplementation(
		(path: string, opts?: { method?: string }) => {
			const method = opts?.method ?? "GET";
			if (path.startsWith("/v7/profiles/")) {
				return Promise.resolve(ok({ profiles: [fullProfile()] }));
			}
			if (path === "/v4/me/profile" && method === "PATCH") {
				return Promise.resolve(ok(null));
			}
			if (path === "/v3.1/me/profile" && method === "PUT") {
				return Promise.resolve(ok({}));
			}
			if (path === "/v4/me/profile") {
				return Promise.resolve(ok({ profiles: [shortProfile()] }));
			}
			if (path === "/v3/me/profile/images") {
				return Promise.resolve(ok(null));
			}
			throw new Error(`unexpected request: ${method} ${path}`);
		},
	);
});

afterEach(() => {
	resetNowForTesting();
});

function countRequests(pathPrefix: string): number {
	return fetchRestMock.mock.calls.filter(([path]) =>
		path.startsWith(pathPrefix),
	).length;
}

describe("cache TTL", () => {
	it("ignores an unreadable persisted profile cache", async () => {
		readCachedProfileEntryMock.mockRejectedValueOnce(
			new Error("corrupt cache"),
		);

		await expect(getPersistedProfile(PROFILE_ID)).resolves.toBeNull();
	});

	it("serves getProfile from cache within the TTL and refetches after it", async () => {
		let clock = 1_000;
		setNowForTesting(() => clock);

		await getProfile(PROFILE_ID);
		await getProfile(PROFILE_ID);
		expect(countRequests("/v7/profiles/")).toBe(1);

		clock += 59_999;
		await getProfile(PROFILE_ID);
		expect(countRequests("/v7/profiles/")).toBe(1);

		clock += 1;
		await getProfile(PROFILE_ID);
		expect(countRequests("/v7/profiles/")).toBe(2);
	});

	it("serves getMyProfile from cache within the TTL and refetches after it", async () => {
		let clock = 1_000;
		setNowForTesting(() => clock);

		await getMyProfile();
		await getMyProfile();
		expect(countRequests("/v4/me/profile")).toBe(1);

		clock += 60_000;
		await getMyProfile();
		expect(countRequests("/v4/me/profile")).toBe(2);
	});

	it("refetches when a profile summary reports newer server data", async () => {
		setNowForTesting(() => 10_000);
		await getProfile(PROFILE_ID);
		noteProfileFreshness(PROFILE_ID, 2_000);

		await getProfile(PROFILE_ID);

		expect(countRequests("/v7/profiles/")).toBe(2);
	});

	it("does not reuse or persist a late profile response across accounts", async () => {
		let resolveFirst!: (value: ReturnType<typeof ok>) => void;
		fetchRestMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		const first = getProfile(PROFILE_ID);
		await vi.waitFor(() => expect(fetchRestMock).toHaveBeenCalledOnce());

		activateAccountSession(2);
		fetchRestMock.mockResolvedValueOnce(
			ok({ profiles: [{ ...fullProfile(), displayName: "Account B" }] }),
		);
		await expect(getProfile(PROFILE_ID)).resolves.toMatchObject({
			displayName: "Account B",
		});

		resolveFirst(
			ok({ profiles: [{ ...fullProfile(), displayName: "Account A" }] }),
		);
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() =>
			expect(writeCachedProfileMock).toHaveBeenCalledOnce(),
		);
		expect(writeCachedProfileMock).toHaveBeenCalledWith(
			expect.objectContaining({ displayName: "Account B" }),
			expect.any(Number),
		);
	});
});

describe("getProfiles batching", () => {
	it.each([31, 60, 150])(
		"caps every /v3/profiles request for %i IDs at the configured official limit",
		async (count) => {
			const profileIds = Array.from({ length: count }, (_, index) => index + 1);
			fetchRestMock.mockImplementation(
				(_path: string, options?: { body?: unknown }) => {
					const targetProfileIds = (
						options?.body as { targetProfileIds: number[] }
					).targetProfileIds;
					return Promise.resolve(
						ok({
							profiles: targetProfileIds.map((profileId) => ({
								...shortProfile(),
								profileId,
							})),
						}),
					);
				},
			);

			const profiles = await getProfiles(profileIds);

			expect(profiles.map((profile) => profile.profileId)).toEqual(profileIds);
			expect(
				fetchRestMock.mock.calls.map(
					([, options]) =>
						(options?.body as { targetProfileIds: number[] }).targetProfileIds
							.length,
				),
			).toEqual(
				Array.from({ length: Math.ceil(count / 30) }, (_, index) =>
					Math.min(30, count - index * 30),
				),
			);
		},
	);

	it("honors a lower configured batch size", async () => {
		getDeveloperSettingsSnapshotMock.mockReturnValueOnce({
			profileResolutionBatchSize: 12,
		});
		fetchRestMock.mockImplementation(
			(_path: string, options?: { body?: unknown }) =>
				Promise.resolve(
					ok({
						profiles: (
							options?.body as { targetProfileIds: number[] }
						).targetProfileIds.map((profileId) => ({
							...shortProfile(),
							profileId,
						})),
					}),
				),
		);

		await getProfiles(Array.from({ length: 31 }, (_, index) => index + 1));

		expect(
			fetchRestMock.mock.calls.map(
				([, options]) =>
					(options?.body as { targetProfileIds: number[] }).targetProfileIds
						.length,
			),
		).toEqual([12, 12, 7]);
	});

	it("deduplicates IDs and restores caller order across server responses", async () => {
		fetchRestMock.mockImplementation(
			(_path: string, options?: { body?: unknown }) =>
				Promise.resolve(
					ok({
						profiles: [
							...(options?.body as { targetProfileIds: number[] })
								.targetProfileIds,
						]
							.reverse()
							.map((profileId) => ({ ...shortProfile(), profileId })),
					}),
				),
		);

		const profiles = await getProfiles([3, 1, 3, 2]);

		expect(profiles.map((profile) => profile.profileId)).toEqual([3, 1, 2]);
		expect(fetchRestMock).toHaveBeenCalledOnce();
		expect(fetchRestMock.mock.calls[0][1]?.body).toEqual({
			targetProfileIds: [3, 1, 2],
		});
	});
});

describe("applyProfileEdit", () => {
	it("deep-merges socialNetworks instead of replacing siblings", () => {
		const base = {
			age: 20,
			socialNetworks: {
				twitter: { userId: "tw" },
				facebook: { userId: "fb" },
			},
		} as unknown as Profile;

		const merged = applyProfileEdit(base, {
			age: 21,
			socialNetworks: { instagram: { userId: "ig" } },
		});

		expect(merged.age).toBe(21);
		expect(merged.socialNetworks).toEqual({
			twitter: { userId: "tw" },
			facebook: { userId: "fb" },
			instagram: { userId: "ig" },
		});
		expect(base.socialNetworks).toEqual({
			twitter: { userId: "tw" },
			facebook: { userId: "fb" },
		});
	});
});

describe("patchOwnProfile", () => {
	it("merges a partial socialNetworks patch into the cached profile", async () => {
		await getProfile(PROFILE_ID);

		await patchOwnProfile(PROFILE_ID, {
			socialNetworks: { instagram: { userId: "ig" } },
		});

		expect((await getProfile(PROFILE_ID)).socialNetworks).toEqual({
			twitter: { userId: "tw" },
			facebook: { userId: "fb" },
			instagram: { userId: "ig" },
		});
	});
});

describe("updateOwnProfile", () => {
	it("uses the full-replace PUT endpoint", async () => {
		await updateOwnProfile(PROFILE_ID, update({ displayName: "Neo" }));

		expect(fetchRestMock).toHaveBeenCalledWith(
			"/v3.1/me/profile",
			expect.objectContaining({ method: "PUT" }),
		);
	});

	it("merges free-text fields the PATCH endpoint ignores into the cache", async () => {
		await getProfile(PROFILE_ID);

		await updateOwnProfile(
			PROFILE_ID,
			update({ displayName: "Neo", aboutMe: "the one" }),
		);

		const cached = await getProfile(PROFILE_ID);
		expect(cached.displayName).toBe("Neo");
		expect(cached.aboutMe).toBe("the one");
	});

	it("merges into the cache when the server answers with an empty body", async () => {
		await getProfile(PROFILE_ID);
		fetchRestMock.mockImplementationOnce(() => Promise.resolve(okRaw("")));

		await updateOwnProfile(PROFILE_ID, update({ displayName: "Trinity" }));

		expect((await getProfile(PROFILE_ID)).displayName).toBe("Trinity");
	});

	it("throws ProfileModerationError with the banned terms on a 400", async () => {
		await getProfile(PROFILE_ID);
		fetchRestMock.mockImplementationOnce(() =>
			Promise.resolve(
				httpError(400, {
					type: "urn:gr:err:hit_banned_terms",
					title: "Hit banned terms",
					status: 400,
					display_name: { terms: ["BANNED_TERM"] },
				}),
			),
		);

		const error = await updateOwnProfile(
			PROFILE_ID,
			update({ displayName: "BANNED_TERM" }),
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ProfileModerationError);
		expect((error as ProfileModerationError).rejected).toEqual([
			{ field: "Display name", terms: ["BANNED_TERM"] },
		]);
		expect((await getProfile(PROFILE_ID)).displayName).toBeUndefined();
	});

	it("hard-fails on a non-200 whose body is not a banned-terms error", async () => {
		await getProfile(PROFILE_ID);
		fetchRestMock.mockImplementationOnce(() =>
			Promise.resolve(httpError(400, { type: "urn:gr:err:something_else" })),
		);

		await expect(
			updateOwnProfile(PROFILE_ID, update({ displayName: "Neo" })),
		).rejects.toThrow("status 400");

		expect((await getProfile(PROFILE_ID)).displayName).toBeUndefined();
	});

	it("hard-fails on a non-200 with an unparseable body", async () => {
		fetchRestMock.mockImplementationOnce(() =>
			Promise.resolve(httpError(500, "<html>err</html>")),
		);

		await expect(
			updateOwnProfile(PROFILE_ID, update({ displayName: "Neo" })),
		).rejects.toThrow("status 500");
	});

	it("does not treat a non-200 success code as success", async () => {
		await getProfile(PROFILE_ID);
		fetchRestMock.mockImplementationOnce(() => Promise.resolve(okRaw("", 204)));

		await expect(
			updateOwnProfile(PROFILE_ID, update({ displayName: "Neo" })),
		).rejects.toBeInstanceOf(Error);

		expect((await getProfile(PROFILE_ID)).displayName).toBeUndefined();
	});
});

describe("deleteProfilePhotos", () => {
	it("removes the hash from both the full and short profile caches", async () => {
		await getProfile(PROFILE_ID);
		await getMyProfile();

		await deleteProfilePhotos(PROFILE_ID, ["a"]);

		expect((await getProfile(PROFILE_ID)).medias).toEqual([{ mediaHash: "b" }]);
		expect((await getMyProfile()).medias).toEqual([{ mediaHash: "b" }]);
	});

	it("does not send a request when there are no hashes to remove", async () => {
		await deleteProfilePhotos(PROFILE_ID, []);

		expect(fetchRestMock).not.toHaveBeenCalled();
	});
});
