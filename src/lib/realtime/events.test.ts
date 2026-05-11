import { describe, expect, it } from "vitest";
import {
	parseRealtimeCommandResponse,
	parseRealtimeEvent,
} from "$lib/realtime/events";

describe("parseRealtimeEvent", () => {
	it("parses compact JSON websocket events", () => {
		expect(
			parseRealtimeEvent(
				JSON.stringify({
					type: "ws.connection.established",
					timestamp: 1_710_000_000_000,
				}),
			),
		).toEqual({
			type: "ws.connection.established",
			timestamp: 1_710_000_000_000,
		});
	});
});

describe("parseRealtimeCommandResponse", () => {
	it("requires command response metadata", () => {
		expect(
			parseRealtimeCommandResponse({
				type: "chat.v1.message.send.response",
				ref: "ref-1",
				status: 200,
				payload: { messageId: "message-1" },
			}),
		).toEqual({
			type: "chat.v1.message.send.response",
			ref: "ref-1",
			status: 200,
			payload: { messageId: "message-1" },
		});

		expect(() =>
			parseRealtimeCommandResponse({
				type: "chat.v1.message.send.response",
				payload: {},
			}),
		).toThrow();
	});
});
