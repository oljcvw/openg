import { describe, expect, it } from "vitest";

import { canUnsendMessage } from "./message-actions";

type MessageCandidate = {
	messageId: string;
	unsent: boolean;
	type: string;
	status: string;
};

function message(overrides: Partial<MessageCandidate> = {}): MessageCandidate {
	return {
		messageId: "message-1",
		unsent: false,
		type: "Text",
		status: "sent",
		...overrides,
	};
}

describe("canUnsendMessage", () => {
	it("allows only stable sent outgoing messages", () => {
		expect(canUnsendMessage(message(), true)).toBe(true);
		expect(canUnsendMessage(message(), false)).toBe(false);
		expect(canUnsendMessage(message({ status: "pending" }), true)).toBe(false);
		expect(
			canUnsendMessage(message({ messageId: "pending-local" }), true),
		).toBe(false);
		expect(canUnsendMessage(message({ unsent: true }), true)).toBe(false);
	});

	it("rejects control and call-history messages", () => {
		expect(canUnsendMessage(message({ type: "Retract" }), true)).toBe(false);
		expect(canUnsendMessage(message({ type: "VideoCall" }), true)).toBe(false);
	});
});
