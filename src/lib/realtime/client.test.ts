import { describe, expect, it, vi } from "vitest";
import { RealtimeClient, type RealtimeTransport } from "$lib/realtime/client";

class FakeTransport implements RealtimeTransport {
	sent: string[] = [];
	messageHandlers = new Set<(message: string) => void>();
	closeHandlers = new Set<
		(event: { code?: number; reason?: string }) => void
	>();

	async connect() {}

	async send(message: string) {
		this.sent.push(message);
	}

	async close(code?: number, reason?: string) {
		this.emitClose({ code, reason });
	}

	onMessage(handler: (message: string) => void) {
		this.messageHandlers.add(handler);
		return () => this.messageHandlers.delete(handler);
	}

	onClose(handler: (event: { code?: number; reason?: string }) => void) {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	emitMessage(message: unknown) {
		const encoded =
			typeof message === "string" ? message : JSON.stringify(message);
		for (const handler of this.messageHandlers) handler(encoded);
	}

	emitClose(event: { code?: number; reason?: string } = {}) {
		for (const handler of this.closeHandlers) handler(event);
	}
}

describe("RealtimeClient", () => {
	it("sends commands with token and unique refs, then resolves matching responses", async () => {
		const transport = new FakeTransport();
		const client = new RealtimeClient({
			transport,
			getToken: async () => "session-1",
			makeRef: () => "ref-1",
		});

		await client.connect();
		const response = client.command("chat.v1.message.send", {
			body: { text: "hello" },
		});

		await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
		expect(JSON.parse(transport.sent[0])).toEqual({
			type: "chat.v1.message.send",
			ref: "ref-1",
			token: "session-1",
			payload: {
				body: { text: "hello" },
			},
		});

		transport.emitMessage({
			type: "chat.v1.message.send.response",
			ref: "ref-1",
			status: 200,
			payload: { messageId: "message-1" },
		});

		await expect(response).resolves.toEqual({
			type: "chat.v1.message.send.response",
			ref: "ref-1",
			status: 200,
			payload: { messageId: "message-1" },
		});
	});

	it("notifies subscribers for realtime notification events", async () => {
		const transport = new FakeTransport();
		const client = new RealtimeClient({
			transport,
			getToken: async () => "session-1",
		});
		const onMessageSent = vi.fn();

		client.on("chat.v1.message_sent", onMessageSent);
		await client.connect();
		transport.emitMessage({
			type: "chat.v1.message_sent",
			notificationId: null,
			ref: null,
			payload: { messageId: "message-1" },
		});

		expect(onMessageSent).toHaveBeenCalledWith({
			type: "chat.v1.message_sent",
			notificationId: null,
			ref: null,
			payload: { messageId: "message-1" },
		});
	});

	it("rejects pending commands when the transport closes", async () => {
		const transport = new FakeTransport();
		const client = new RealtimeClient({
			transport,
			getToken: async () => "session-1",
			makeRef: () => "ref-1",
		});

		await client.connect();
		const response = client.command("chat.v1.message.send", {
			body: { text: "hello" },
		});
		await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
		transport.emitClose({ code: 4401, reason: "expired token" });

		await expect(response).rejects.toThrow(
			"Realtime connection closed before response for ref ref-1",
		);
	});

	it("does not send commands that are still waiting for a token after close", async () => {
		const transport = new FakeTransport();
		let resolveToken!: (token: string) => void;
		const token = new Promise<string>((resolve) => {
			resolveToken = resolve;
		});
		const client = new RealtimeClient({
			transport,
			getToken: () => token,
			makeRef: () => "ref-1",
		});

		await client.connect();
		const response = client.command("chat.v1.message.send", {
			body: { text: "hello" },
		});
		transport.emitClose({ code: 1000 });
		resolveToken("session-1");

		await expect(response).rejects.toThrow(
			"Realtime connection closed before response for ref ref-1",
		);
		expect(transport.sent).toHaveLength(0);
	});
});
