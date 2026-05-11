import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteMessage,
	getConversationMessage,
	markConversationRead,
	refreshMessages,
	sendTypingStatus,
	unsendMessage,
} from "$lib/api/messages";
import { fetchRest } from "$lib/api";

vi.mock("$lib/api", () => ({
	fetchRest: vi.fn(),
	parseApiResponse: vi.fn((options) => options.data),
}));

const mockedFetchRest = vi.mocked(fetchRest);

describe("message gap endpoints", () => {
	beforeEach(() => {
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) => schema.parse({ message: baseMessage() })),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("fetches a single message in a conversation", async () => {
		await getConversationMessage({
			conversationId: "1:2",
			messageId: "1774296692000:843daee8-1e93-47d6-bc7f-3d981925a393",
		});

		expect(mockedFetchRest).toHaveBeenCalledWith(
			"/v4/chat/conversation/1%3A2/message/1774296692000%3A843daee8-1e93-47d6-bc7f-3d981925a393",
			{ method: "GET" },
		);
	});

	it("refreshes specific messages by id", async () => {
		mockedFetchRest.mockResolvedValue({
			jsonParsed: vi.fn((schema) => schema.parse({ messages: [baseMessage()] })),
		} as unknown as Awaited<ReturnType<typeof fetchRest>>);

		await refreshMessages({
			conversationId: "1:2",
			messageIds: ["message-1", "message-2"],
		});

		expect(mockedFetchRest).toHaveBeenCalledWith(
			"/v4/chat/conversation/1%3A2/message-by-id",
			{
				method: "POST",
				body: { messageIds: ["message-1", "message-2"] },
			},
		);
	});

	it("marks a conversation read up to a message id", async () => {
		await markConversationRead({
			conversationId: "1:2",
			messageId: "message-1",
		});

		expect(mockedFetchRest).toHaveBeenCalledWith(
			"/v4/chat/conversation/1%3A2/read/message-1",
			{ method: "POST" },
		);
	});

	it("unsends messages", async () => {
		await unsendMessage({ conversationId: "1:2", messageId: "message-1" });

		expect(mockedFetchRest).toHaveBeenCalledWith("/v4/chat/message/unsend", {
			method: "POST",
			body: { conversationId: "1:2", messageId: "message-1" },
		});
	});

	it("deletes messages locally", async () => {
		await deleteMessage({ conversationId: "1:2", messageId: "message-1" });

		expect(mockedFetchRest).toHaveBeenCalledWith("/v4/chat/message/delete", {
			method: "POST",
			body: { conversationId: "1:2", messageId: "message-1" },
		});
	});

	it("sends typing status updates", async () => {
		await sendTypingStatus({ conversationId: "1:2", status: "Typing" });

		expect(mockedFetchRest).toHaveBeenCalledWith("/v4/chatstatus/typing", {
			method: "POST",
			body: { conversationId: "1:2", status: "Typing" },
		});
	});
});

function baseMessage() {
	return {
		type: "Text",
		body: { text: "hello" },
		messageId: "1774296692000:843daee8-1e93-47d6-bc7f-3d981925a393",
		conversationId: "1:2",
		senderId: 1,
		timestamp: 1774296692000,
		unsent: false,
		reactions: [],
	};
}
