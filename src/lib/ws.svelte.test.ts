import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

const {
	getDeveloperSettingsSnapshotMock,
	invokeMock,
	listenMock,
	listeners,
	reportClientDiagnosticMock,
	unlistenMock,
} = vi.hoisted(() => ({
	getDeveloperSettingsSnapshotMock: vi.fn(() => ({
		apiRequestTimeoutMs: 35_000,
	})),
	invokeMock: vi.fn(),
	listenMock: vi.fn(
		(eventName: string, handler: (event: { payload: unknown }) => void) => {
			listeners.set(eventName, handler);
			return Promise.resolve(unlistenMock);
		},
	),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	reportClientDiagnosticMock: vi.fn(),
	unlistenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: listenMock,
}));
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportClientDiagnostic: reportClientDiagnosticMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: getDeveloperSettingsSnapshotMock,
}));

import { ws } from "./ws.svelte";

describe("WsState validation diagnostics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		invokeMock.mockReset();
		reportClientDiagnosticMock.mockReset();
		unlistenMock.mockReset();
		getDeveloperSettingsSnapshotMock.mockReturnValue({
			apiRequestTimeoutMs: 35_000,
		});
	});

	afterEach(() => vi.restoreAllMocks());

	it("redacts transport failure details from logs and diagnostics", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const consoleLog = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		invokeMock.mockRejectedValue(new Error("private transport failure"));

		ws.connect();
		ws.send("chat.v1.private", { secret: "private payload" });
		listeners.get("ws:ws_error")?.({ payload: "private server response" });

		await vi.waitFor(() =>
			expect(reportClientDiagnosticMock).toHaveBeenCalledTimes(3),
		);
		expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
			category: "transport_error",
			component: "websocket",
			code: "server_error",
			level: "error",
		});
		const recorded = JSON.stringify([
			...consoleError.mock.calls,
			...reportClientDiagnosticMock.mock.calls,
		]);
		expect(recorded).not.toContain("private transport failure");
		expect(recorded).not.toContain("private payload");
		expect(recorded).not.toContain("private server response");
		expect(consoleLog).toHaveBeenCalledWith("[ws] connecting...");
	});

	it("does not log malformed payload values or schema paths", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const handler = vi.fn();
		await ws.on(
			"chat.v1.private_test",
			z.object({
				type: z.literal("chat.v1.private_test"),
				payload: z.object({ privateMessage: z.number() }),
			}),
			handler,
		);

		listeners.get("grindr:chat_v1_private_test")?.({
			payload: {
				type: "chat.v1.private_test",
				payload: { privateMessage: "secret message value" },
			},
		});

		expect(handler).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			"[ws] unexpected payload for chat.v1.private_test",
			{ issueCount: 1, issueCodes: ["invalid_type"] },
		);
		const logged = JSON.stringify(consoleError.mock.calls);
		expect(logged).not.toContain("secret message value");
		expect(logged).not.toContain("privateMessage");
	});

	it("degrades listener registration failures without rejecting", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		listenMock.mockRejectedValueOnce("private native failure details");

		const unlisten = await ws.on(
			"chat.v1.message_sent",
			z.object({ type: z.string() }),
			vi.fn(),
		);

		expect(() => unlisten()).not.toThrow();
		expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
			category: "listener_error",
			component: "websocket",
			code: "subscribe_chat_v1_message_sent",
			level: "error",
		});
		expect(JSON.stringify(reportClientDiagnosticMock.mock.calls)).not.toContain(
			"private native failure details",
		);
		expect(consoleError).toHaveBeenCalledWith(
			"[ws] listener registration failed",
			{ code: "subscribe_chat_v1_message_sent" },
		);
	});
});

describe("WsState request", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		invokeMock.mockReset();
		unlistenMock.mockReset();
		getDeveloperSettingsSnapshotMock.mockReturnValue({
			apiRequestTimeoutMs: 35_000,
		});
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
			.mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("matches the response command ref and cleans up its listener", async () => {
		invokeMock.mockResolvedValue(undefined);
		const request = ws.request(
			"chat.v1.message.send",
			{ body: { text: "hello" } },
			z.object({ messageId: z.string() }),
		);
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		expect(invokeMock).toHaveBeenCalledWith("ws_send", {
			command: {
				type: "chat.v1.message.send",
				ref_id: "00000000-0000-4000-8000-000000000001",
				payload: { body: { text: "hello" } },
			},
		});

		const response = listeners.get("grindr:chat_v1_message_send_response");
		response?.({
			payload: {
				type: "chat.v1.message.send.response",
				ref: "different-ref",
				status: 200,
				payload: { messageId: "wrong" },
			},
		});
		response?.({
			payload: {
				type: "chat.v1.message.send.response",
				ref: "00000000-0000-4000-8000-000000000001",
				status: 200,
				payload: { messageId: "msg-1" },
			},
		});

		await expect(request).resolves.toEqual({ messageId: "msg-1" });
		expect(unlistenMock).toHaveBeenCalledTimes(1);
	});

	it("uses the configured timeout and removes the response listener", async () => {
		getDeveloperSettingsSnapshotMock.mockReturnValue({
			apiRequestTimeoutMs: 5_000,
		});
		invokeMock.mockResolvedValue(undefined);
		const request = ws.request(
			"chat.v1.message.send",
			{},
			z.object({ messageId: z.string() }),
		);
		const rejection = expect(request).rejects.toThrow(
			"WebSocket request timed out",
		);
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(5_000);

		await rejection;
		expect(unlistenMock).toHaveBeenCalledTimes(1);
	});

	it("cleans up when the native send fails", async () => {
		invokeMock.mockRejectedValue(new Error("send failed"));
		const request = ws.request(
			"chat.v1.message.send",
			{},
			z.object({ messageId: z.string() }),
		);

		await expect(request).rejects.toThrow("send failed");
		expect(unlistenMock).toHaveBeenCalledTimes(1);
	});
});

describe("WsState request outcome", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		invokeMock.mockReset();
		listenMock.mockClear();
		unlistenMock.mockReset();
		getDeveloperSettingsSnapshotMock.mockReturnValue({
			apiRequestTimeoutMs: 5_000,
		});
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000010",
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("accepts an opaque successful response as an acknowledgement", async () => {
		invokeMock.mockResolvedValue(undefined);
		const outcome = ws.requestOutcome("chat.v1.message.send", {
			ref: "attempt",
		});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		listeners.get("grindr:chat_v1_message_send_response")?.({
			payload: {
				type: "chat.v1.message.send.response",
				ref: "00000000-0000-4000-8000-000000000010",
				status: 204,
				payload: null,
			},
		});

		await expect(outcome).resolves.toEqual({ kind: "ack", payload: null });
	});

	it("subscribes before enqueueing the command", async () => {
		invokeMock.mockResolvedValue(undefined);
		void ws.requestOutcome("chat.v1.message.send", { ref: "attempt" });
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		expect(listenMock.mock.invocationCallOrder[0]!).toBeLessThan(
			invokeMock.mock.invocationCallOrder[0]!,
		);
	});

	it("classifies a server rejection as definitely not sent", async () => {
		invokeMock.mockResolvedValue(undefined);
		const outcome = ws.requestOutcome("chat.v1.message.send", {});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		listeners.get("grindr:chat_v1_message_send_response")?.({
			payload: {
				type: "chat.v1.message.send.response",
				ref: "00000000-0000-4000-8000-000000000010",
				status: 422,
				payload: {},
			},
		});

		await expect(outcome).resolves.toMatchObject({ kind: "notSent" });
	});

	it("classifies a timeout as unknown instead of not sent", async () => {
		invokeMock.mockResolvedValue(undefined);
		const outcome = ws.requestOutcome("chat.v1.message.send", {});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(5_000);

		await expect(outcome).resolves.toEqual({
			kind: "unknown",
			reason: "timeout",
		});
	});

	it("classifies a disconnect after enqueue as an unknown outcome", async () => {
		invokeMock.mockResolvedValue(undefined);
		const outcome = ws.requestOutcome("chat.v1.message.send", {});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

		listeners.get("ws:disconnected")?.({ payload: undefined });

		await expect(outcome).resolves.toEqual({
			kind: "unknown",
			reason: "disconnect",
		});
	});

	it("classifies a native bridge rejection after enqueue is attempted as ambiguous", async () => {
		invokeMock.mockRejectedValue(new Error("bridge reply lost"));

		await expect(
			ws.requestOutcome("chat.v1.message.send", {}),
		).resolves.toEqual({
			kind: "unknown",
			reason: "ambiguousResponse",
		});
	});
});
