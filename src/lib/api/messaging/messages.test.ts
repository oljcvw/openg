import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRestMock, wsRequestMock, wsSendMock } = vi.hoisted(() => ({
	fetchRestMock: vi.fn(),
	wsRequestMock: vi.fn(),
	wsSendMock: vi.fn(),
}));

vi.mock("$lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/api")>()),
	fetchRest: fetchRestMock,
}));
vi.mock("$lib/ws.svelte", () => ({
	ws: { request: wsRequestMock, send: wsSendMock },
}));

import {
	deleteMessageForMe,
	getConversationMessages,
	getSingleMessage,
	reactToMessage,
	sendExpiringVideoMessage,
	sendMessage,
	sendReplyMessage,
	unsendMessage,
} from "$lib/api/messaging/messages";

function apiMessage(overrides = {}) {
	return {
		type: "Text",
		body: { text: "hello" },
		messageId: "msg-1",
		conversationId: "conversation-1",
		senderId: 42,
		timestamp: 1_710_000_000_000,
		unsent: false,
		reactions: [],
		...overrides,
	};
}

function response({
	data,
	status = 200,
	assertOkErrorMessage,
}: {
	data?: unknown;
	status?: number;
	assertOkErrorMessage?: string;
} = {}) {
	return {
		status,
		assertOk() {
			if (status >= 200 && status < 300) return;
			throw new Error(
				assertOkErrorMessage ?? `API request failed with status ${status}`,
			);
		},
		json: () => data,
		jsonParsed: vi.fn((schema: { parse(value: unknown): unknown }) =>
			schema.parse(data),
		),
	};
}

beforeEach(() => {
	fetchRestMock.mockReset();
	wsSendMock.mockReset();
	wsRequestMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("message API wrappers", () => {
	it("loads conversation messages with profile and page key parameters", async () => {
		const data = {
			lastReadTimestamp: null,
			messages: [apiMessage()],
			profile: {
				distance: null,
				mediaHash: null,
				name: "Alex",
				onlineUntil: null,
				profileId: 42,
				showDistance: true,
			},
		};
		fetchRestMock.mockResolvedValue(response({ data }));

		await expect(
			getConversationMessages({
				conversationId: "conversation-1",
				pageKey: "next-page",
			}),
		).resolves.toEqual(data);

		expect(fetchRestMock).toHaveBeenCalledWith(
			"/v5/chat/conversation/conversation-1/message?profile=true&pageKey=next-page",
			{ method: "GET" },
		);
	});

	it("keeps valid siblings when one rich message body is malformed", async () => {
		const data = {
			lastReadTimestamp: null,
			messages: [
				apiMessage({ messageId: "valid" }),
				apiMessage({
					type: "VideoCall",
					body: { videoCallDuration: "invalid" },
					messageId: "malformed",
				}),
			],
			profile: {
				distance: null,
				mediaHash: null,
				name: "Alex",
				onlineUntil: null,
				profileId: 42,
				showDistance: true,
			},
		};
		fetchRestMock.mockResolvedValue(response({ data }));

		const result = await getConversationMessages({
			conversationId: "conversation-1",
		});

		expect(result.messages.map((message) => message.type)).toEqual([
			"Text",
			"Unknown",
		]);
	});

	it("loads a single message by conversation and message id", async () => {
		const data = { message: apiMessage({ messageId: "msg-2" }) };
		fetchRestMock.mockResolvedValue(response({ data }));

		await expect(
			getSingleMessage({
				conversationId: "conversation-1",
				messageId: "msg-2",
			}),
		).resolves.toEqual(data);

		expect(fetchRestMock).toHaveBeenCalledWith(
			"/v4/chat/conversation/conversation-1/message/msg-2",
			{ method: "GET" },
		);
	});

	it("sends direct messages through the expected request shape", async () => {
		const message = apiMessage();
		fetchRestMock.mockResolvedValue(response({ data: message }));

		await expect(
			sendMessage({
				toUserId: 99,
				message: { type: "Text", body: { text: "hello" } },
			}),
		).resolves.toEqual(message);

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/send", {
			method: "POST",
			body: {
				type: "Text",
				target: { type: "Direct", targetId: 99 },
				body: { text: "hello" },
			},
		});
	});

	it("sends image messages by media reference only", async () => {
		const imageBody = {
			mediaId: 910_001,
			width: null,
			height: null,
			url: "https://cdns.grindr.com/images/chat/a".padEnd(100, "b"),
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: 1_710_000_000_000,
		};
		const responseMessage = apiMessage({ type: "Image", body: imageBody });
		fetchRestMock.mockResolvedValue(response({ data: responseMessage }));

		await expect(
			sendMessage({
				toUserId: 99,
				message: { type: "Image", body: imageBody },
			}),
		).resolves.toEqual(responseMessage);

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/send", {
			method: "POST",
			body: {
				type: "Image",
				target: { type: "Direct", targetId: 99 },
				body: { mediaId: 910_001 },
			},
		});
	});

	it("sends audio messages by media reference only", async () => {
		const audioBody = {
			mediaId: 910_002,
			mediaHash: "a".repeat(64),
			url: "https://audio.example/message.aac",
			contentType: "audio/aac",
			length: 12_345,
			expiresAt: 1_710_000_900_000,
		};
		const responseMessage = apiMessage({ type: "Audio", body: audioBody });
		fetchRestMock.mockResolvedValue(response({ data: responseMessage }));

		await sendMessage({
			toUserId: 99,
			message: { type: "Audio", body: audioBody },
		});

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/send", {
			method: "POST",
			body: {
				type: "Audio",
				target: { type: "Direct", targetId: 99 },
				body: { mediaId: 910_002 },
			},
		});
	});

	it("sends expiring video over the exact WebSocket command contract", () => {
		sendExpiringVideoMessage({
			toUserId: 99,
			mediaId: 910_003,
			looping: false,
			maxViews: 2,
		});

		expect(wsSendMock).toHaveBeenCalledWith("chat.v1.message.send", {
			type: "Video",
			target: { type: "Direct", targetId: 99 },
			body: { mediaId: 910_003, looping: false, maxViews: 2 },
		});
	});

	it("sends replies over the exact WebSocket command contract", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000003",
		);
		const message = apiMessage({
			refValue: "00000000-0000-4000-8000-000000000003",
		});
		wsRequestMock.mockResolvedValue(message);

		await expect(
			sendReplyMessage({
				toUserId: 99,
				message: { type: "Text", body: { text: "hello" } },
				replyToMessageId: "original-message",
			}),
		).resolves.toEqual(message);

		expect(wsRequestMock).toHaveBeenCalledWith(
			"chat.v1.message.send",
			{
				type: "Text",
				target: { type: "Direct", targetId: 99 },
				body: { text: "hello" },
				ref: "00000000-0000-4000-8000-000000000003",
				replyToMessageId: "original-message",
			},
			expect.anything(),
		);
		expect(fetchRestMock).not.toHaveBeenCalled();
	});

	it("sends reply media by reference without changing plain sends", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000004",
		);
		wsRequestMock.mockResolvedValue(apiMessage({ type: "Image" }));
		const imageBody = {
			mediaId: 910_001,
			width: null,
			height: null,
			url: "https://cdns.grindr.com/images/chat/a".padEnd(100, "b"),
			imageHash: "a".repeat(64),
			takenOnGrindr: false,
			createdAt: 1_710_000_000_000,
		};

		await sendReplyMessage({
			toUserId: 99,
			message: { type: "Image", body: imageBody },
			replyToMessageId: "original-message",
		});

		expect(wsRequestMock).toHaveBeenCalledWith(
			"chat.v1.message.send",
			expect.objectContaining({ body: { mediaId: 910_001 } }),
			expect.anything(),
		);
	});

	it("sends location coordinates unchanged", async () => {
		const message = apiMessage({
			type: "Location",
			body: { lat: 53.35, lon: -6.26 },
		});
		fetchRestMock.mockResolvedValue(response({ data: message }));

		await sendMessage({
			toUserId: 99,
			message: { type: "Location", body: { lat: 53.35, lon: -6.26 } },
		});

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/send", {
			method: "POST",
			body: {
				type: "Location",
				target: { type: "Direct", targetId: 99 },
				body: { lat: 53.35, lon: -6.26 },
			},
		});
	});

	it("posts reactions without parsing a response body", async () => {
		const res = response();
		fetchRestMock.mockResolvedValue(res);

		await expect(
			reactToMessage({
				conversationId: "conversation-1",
				messageId: "msg-1",
				reactionType: 1,
			}),
		).resolves.toBe(res);

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/reaction", {
			method: "POST",
			body: {
				conversationId: "conversation-1",
				messageId: "msg-1",
				reactionType: 1,
			},
		});
	});

	it("throws when delete requests return non-200 statuses", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		fetchRestMock.mockResolvedValue(
			response({
				data: { error: true },
				status: 500,
				assertOkErrorMessage: "Failed to delete message",
			}),
		);

		await expect(
			deleteMessageForMe({
				conversationId: "conversation-1",
				messageId: "msg-1",
			}),
		).rejects.toThrow("Failed to delete message");

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/delete", {
			method: "POST",
			body: {
				conversationId: "conversation-1",
				messageId: "msg-1",
			},
		});
	});

	it("throws when unsend requests return non-200 statuses", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		fetchRestMock.mockResolvedValue(
			response({
				data: { error: true },
				status: 500,
				assertOkErrorMessage: "Failed to unsend message",
			}),
		);

		await expect(
			unsendMessage({
				conversationId: "conversation-1",
				messageId: "msg-1",
			}),
		).rejects.toThrow("Failed to unsend message");

		expect(fetchRestMock).toHaveBeenCalledWith("/v4/chat/message/unsend", {
			method: "POST",
			body: {
				conversationId: "conversation-1",
				messageId: "msg-1",
			},
		});
	});
});
