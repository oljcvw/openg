import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock } = vi.hoisted(() => ({ fetchRestMock: vi.fn() }));

vi.mock("$lib/api", () => ({ fetchRest: fetchRestMock }));

import {
	createVideoCall,
	getVideoCallInfo,
	joinVideoCall,
	leaveVideoCall,
	renewVideoCall,
} from "$lib/api/video-call";

function response(body: unknown) {
	return {
		assertOk: vi.fn(),
		jsonParsed: vi.fn((schema) => schema.parse(body)),
	};
}

describe("video-call API", () => {
	beforeEach(() => fetchRestMock.mockReset());

	it("loads remaining call allowance", async () => {
		fetchRestMock.mockResolvedValue(response({ remainingSeconds: 42 }));

		await expect(getVideoCallInfo()).resolves.toEqual({ remainingSeconds: 42 });
		expect(fetchRestMock).toHaveBeenCalledWith("/v3/video-call");
	});

	it("creates a call and prefers channel and remainingSeconds aliases", async () => {
		fetchRestMock.mockResolvedValue(
			response({
				result: "Success",
				maxSeconds: 120,
				remainingSeconds: 75,
				channelId: "legacy-channel",
				channel: "current-channel",
				token: "token",
				refreshSeconds: 20,
			}),
		);

		await expect(createVideoCall({ targetProfileId: 123 })).resolves.toEqual({
			result: "Success",
			channelId: "current-channel",
			token: "token",
			remainingSeconds: 75,
			refreshSeconds: 20,
			message: null,
		});
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/video-call", {
			method: "POST",
			body: { targetProfileId: 123 },
		});
	});

	it("falls back to maxSeconds and channelId", async () => {
		fetchRestMock.mockResolvedValue(
			response({
				result: "Success",
				maxSeconds: 55,
				channelId: "legacy-channel",
			}),
		);

		await expect(
			createVideoCall({ targetProfileId: 9 }),
		).resolves.toMatchObject({
			channelId: "legacy-channel",
			remainingSeconds: 55,
		});
	});

	it("joins and leaves with the server channel contract", async () => {
		fetchRestMock
			.mockResolvedValueOnce(
				response({ result: "Success", channel: "joined", token: "token" }),
			)
			.mockResolvedValueOnce(response(null));

		await expect(
			joinVideoCall({ channelId: "incoming", remainingSeconds: 30 }),
		).resolves.toMatchObject({
			channelId: "joined",
			remainingSeconds: 30,
		});
		await leaveVideoCall("joined");

		expect(fetchRestMock).toHaveBeenNthCalledWith(1, "/v1/video-call/join", {
			method: "PATCH",
			body: { channelId: "incoming" },
		});
		expect(fetchRestMock).toHaveBeenNthCalledWith(2, "/v1/video-call/leave", {
			method: "PATCH",
			body: { channelId: "joined" },
		});
	});

	it("renews without a request body", async () => {
		fetchRestMock.mockResolvedValue(
			response({
				result: "Success",
				token: "renewed",
				remainingSeconds: 12,
				refreshSeconds: 5,
			}),
		);

		await expect(renewVideoCall()).resolves.toMatchObject({
			token: "renewed",
			remainingSeconds: 12,
		});
		expect(fetchRestMock).toHaveBeenCalledWith("/v1/video-call", {
			method: "PATCH",
		});
	});

	it.each([
		"Error",
		"ExceededLengthLimit",
		"TargetProfileUnavailable",
	] as const)("preserves %s result", async (result) => {
		fetchRestMock.mockResolvedValue(response({ result }));
		await expect(
			createVideoCall({ targetProfileId: 1 }),
		).resolves.toMatchObject({
			result,
		});
	});
});
