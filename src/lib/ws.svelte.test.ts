import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

const { invokeMock, listenMock, listeners, reportClientDiagnosticMock } =
	vi.hoisted(() => ({
		invokeMock: vi.fn(),
		listenMock: vi.fn(
			(eventName: string, handler: (event: { payload: unknown }) => void) => {
				listeners.set(eventName, handler);
				return Promise.resolve(vi.fn());
			},
		),
		listeners: new Map<string, (event: { payload: unknown }) => void>(),
		reportClientDiagnosticMock: vi.fn(),
	}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: listenMock,
}));
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportClientDiagnostic: reportClientDiagnosticMock,
}));

import { ws } from "./ws.svelte";

describe("WsState validation diagnostics", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		invokeMock.mockReset();
		reportClientDiagnosticMock.mockReset();
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
