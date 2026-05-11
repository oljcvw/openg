import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteConversation,
	muteConversation,
	pinConversation,
	unmuteConversation,
	unpinConversation,
} from "$lib/api/conversation";
import { fetchRest } from "$lib/api";

vi.mock("$lib/api", () => ({
	fetchRest: vi.fn(),
}));

const mockedFetchRest = vi.mocked(fetchRest);

describe("conversation management endpoints", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFetchRest.mockResolvedValue({} as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("deletes a conversation locally", async () => {
		await deleteConversation("1:2");

		expect(mockedFetchRest).toHaveBeenCalledWith(
			"/v4/chat/conversation/1%3A2",
			{ method: "DELETE" },
		);
	});

	it("pins and unpins conversations", async () => {
		await pinConversation("1:2");
		await unpinConversation("1:2");

		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			1,
			"/v4/chat/conversation/1%3A2/pin",
			{ method: "POST" },
		);
		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			2,
			"/v4/chat/conversation/1%3A2/unpin",
			{ method: "POST" },
		);
	});

	it("mutes and unmutes push notifications for conversations", async () => {
		await muteConversation("1:2");
		await unmuteConversation("1:2");

		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			1,
			"/v1/push/conversation/1%3A2/mute",
			{ method: "POST" },
		);
		expect(mockedFetchRest).toHaveBeenNthCalledWith(
			2,
			"/v1/push/conversation/1%3A2/unmute",
			{ method: "POST" },
		);
	});
});
