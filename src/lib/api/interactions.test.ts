import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRest } from "$lib/api";
import {
	addFavorite,
	blockProfile,
	deleteFavoriteNote,
	getBlockedProfiles,
	getFavoriteNote,
	getFavoriteNotes,
	getHiddenProfiles,
	getReceivedTaps,
	getSentTaps,
	hideProfile,
	recordProfileView,
	recordProfileViews,
	removeFavorite,
	sendTap,
	unblockAllProfiles,
	unblockProfile,
	unhideAllProfiles,
	unhideProfile,
	updateFavoriteNote,
} from "$lib/api/interactions";

vi.mock("$lib/api", () => ({
	fetchRest: vi.fn(),
}));

const mockedFetchRest = vi.mocked(fetchRest);

describe("favorite interactions API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue(emptyResponse());
	});

	it("adds and removes favorites", async () => {
		await addFavorite(42);
		await removeFavorite(42);

		expect(mockedFetchRest).toHaveBeenNthCalledWith(1, "/v3/me/favorites/42", {
			method: "POST",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v3/me/favorites/42", {
			method: "DELETE",
		});
	});

	it("reads favorite notes from the top-level array response", async () => {
		mockedFetchRest.mockResolvedValue(
			responseWith([
				{ counterpartyId: 42, notes: "met at pride", phoneNumber: "" },
			]),
		);

		const notes = await getFavoriteNotes();

		expect(mockedFetchRest).toHaveBeenCalledWith("/v1/favorites/notes", {
			method: "GET",
		});
		expect(notes).toEqual([
			{ counterpartyId: 42, notes: "met at pride", phoneNumber: "" },
		]);
	});

	it("reads, updates, and deletes a single favorite note", async () => {
		mockedFetchRest
			.mockResolvedValueOnce(
				responseWith({ notes: "bring coffee", phoneNumber: "+15551234567" }),
			)
			.mockResolvedValueOnce(emptyResponse())
			.mockResolvedValueOnce(emptyResponse());

		await expect(getFavoriteNote(42)).resolves.toEqual({
			notes: "bring coffee",
			phoneNumber: "+15551234567",
		});
		await updateFavoriteNote({
			profileId: 42,
			notes: "bring tea",
			phoneNumber: "",
		});
		await deleteFavoriteNote(42);

		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			2,
			"/v1/favorites/notes/42",
			{
				method: "PUT",
				body: { notes: "bring tea", phoneNumber: "" },
			},
		);
		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			3,
			"/v1/favorites/notes/42",
			{ method: "DELETE" },
		);
	});
});

describe("block and hide interactions API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue(emptyResponse());
	});

	it("loads blocked profiles and writes block state", async () => {
		mockedFetchRest
			.mockResolvedValueOnce(
				responseWith({ blocking: [{ profileId: 42, blockedTime: 0 }] }),
			)
			.mockResolvedValue(emptyResponse());

		await expect(getBlockedProfiles()).resolves.toEqual([
			{ profileId: 42, blockedTime: 0 },
		]);
		await blockProfile(42);
		await unblockProfile(42);
		await unblockAllProfiles();

		expect(mockedFetchRest).toHaveBeenNthCalledWith(1, "/v3.1/me/blocks", {
			method: "GET",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v3/me/blocks/42", {
			method: "POST",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(3, "/v3/me/blocks/42", {
			method: "DELETE",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(4, "/v3/me/blocks", {
			method: "DELETE",
		});
	});

	it("loads hidden profiles and writes hide state", async () => {
		mockedFetchRest
			.mockResolvedValueOnce(
				responseWith({
					hides: [{ profileId: 42, displayName: "Hidden", mediaHash: "hash" }],
				}),
			)
			.mockResolvedValue(emptyResponse());

		await expect(getHiddenProfiles()).resolves.toEqual([
			{ profileId: 42, displayName: "Hidden", mediaHash: "hash" },
		]);
		await hideProfile(42);
		await unhideProfile(42);
		await unhideAllProfiles();

		expect(mockedFetchRest).toHaveBeenNthCalledWith(1, "/v1/hides", {
			method: "GET",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v1/me/hides/42", {
			method: "POST",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(3, "/v1/hides/42", {
			method: "DELETE",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(4, "/v1/hides", {
			method: "DELETE",
		});
	});
});

describe("tap and view interactions API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue(emptyResponse());
	});

	it("sends taps and loads sent/received tap lists", async () => {
		await sendTap({ recipientId: 42, tapType: 1 });

		mockedFetchRest.mockResolvedValueOnce(responseWith({ profiles: [] }));
		await expect(getReceivedTaps()).resolves.toEqual({ profiles: [] });

		mockedFetchRest.mockResolvedValueOnce(
			responseWith([
				{
					senderId: 1,
					receiverId: 42,
					tapType: 1,
					sentOn: 1774296692000,
					deleted: false,
					readOn: null,
				},
			]),
		);
		await expect(getSentTaps()).resolves.toHaveLength(1);

		expect(mockedFetchRest).toHaveBeenNthCalledWith(1, "/v2/taps/add", {
			method: "POST",
			body: { recipientId: 42, tapType: 1 },
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v2/taps/received", {
			method: "GET",
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			3,
			"/v1/interactions/taps/sent",
			{ method: "GET" },
		);
	});

	it("records single and batched profile views", async () => {
		await recordProfileView({
			profileId: 42,
			source: "UNKNOWN",
			foundVia: null,
		});
		await recordProfileViews({ profileIds: [42, 43], foundVia: null });

		expect(mockedFetchRest).toHaveBeenNthCalledWith(1, "/v5/views/42", {
			method: "POST",
			body: { source: "UNKNOWN", foundVia: null },
		});
		expect(mockedFetchRest).toHaveBeenNthCalledWith(2, "/v4/views", {
			method: "POST",
			body: { viewedProfileIds: ["42", "43"], foundVia: null },
		});
	});
});

function responseWith(data: unknown) {
	return {
		jsonParsed: vi.fn((schema) => schema.parse(data)),
	} as unknown as Awaited<ReturnType<typeof fetchRest>>;
}

function emptyResponse() {
	return {
		jsonParsed: vi.fn(() => {
			throw new Error("empty response should not be parsed");
		}),
	} as unknown as Awaited<ReturnType<typeof fetchRest>>;
}
