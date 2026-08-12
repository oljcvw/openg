import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
	sendMessage: vi.fn(),
	sendReplyMessage: vi.fn(),
}));

vi.mock("$lib/api/messaging/messages", () => transport);

import { DirectMessageSession } from "$lib/chat/direct-message-session";

beforeEach(() => {
	transport.sendMessage.mockReset();
	transport.sendReplyMessage.mockReset();
});

describe("DirectMessageSession", () => {
	it("deduplicates one command and exposes bounded delivery state", async () => {
		transport.sendMessage.mockResolvedValue({ kind: "ack" });
		const session = new DirectMessageSession(42);
		const request = {
			message: { type: "Text" as const, body: { text: "Hello" } },
			attemptRef: "attempt",
			commandRef: "command",
		};

		const first = session.send(request);
		const second = session.send(request);
		await expect(first).resolves.toEqual({ kind: "ack" });
		await expect(second).resolves.toEqual({ kind: "ack" });
		expect(transport.sendMessage).toHaveBeenCalledOnce();
		expect(session.deliveryState).toBe("sent");
	});

	it("uses the same acknowledgement path for replies and preserves failure", async () => {
		transport.sendReplyMessage.mockRejectedValue(new Error("offline"));
		const session = new DirectMessageSession(42);

		await expect(
			session.send({
				message: { type: "Text", body: { text: "Hello" } },
				attemptRef: "attempt",
				commandRef: "command",
				replyToMessageId: "reply",
			}),
		).rejects.toThrow("offline");
		expect(session.deliveryState).toBe("failed");
	});

	it("releases a failed command so an explicit retry can use server deduplication", async () => {
		transport.sendMessage
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ kind: "ack" });
		const session = new DirectMessageSession(42);
		const request = {
			message: { type: "Text" as const, body: { text: "Hello" } },
			attemptRef: "attempt",
			commandRef: "stable-command",
		};
		await expect(session.send(request)).rejects.toThrow("offline");
		await expect(session.send(request)).resolves.toEqual({ kind: "ack" });
		expect(transport.sendMessage).toHaveBeenCalledTimes(2);
	});
});
