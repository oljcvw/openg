import { describe, expect, it } from "vitest";

import { VoiceNoteNavigatorState } from "$lib/chat/voice-note-navigator.svelte";
import { apiResponseMessageSchema } from "$lib/model/messaging/messages";

function audio(messageId: string, timestamp: number, unsent = false) {
	return apiResponseMessageSchema.parse({
		type: "Audio",
		body: {
			mediaId: timestamp,
			mediaHash: null,
			url: `https://example.test/${messageId}.m4a`,
			contentType: "audio/mp4",
			length: 1_000,
			expiresAt: null,
		},
		messageId,
		conversationId: "conversation",
		senderId: 42,
		timestamp,
		unsent,
		reactions: [],
	});
}

describe("VoiceNoteNavigatorState", () => {
	it("indexes accessible notes in transcript order and starts at the newest", () => {
		const state = new VoiceNoteNavigatorState();
		state.beginScan();
		state.merge([
			audio("newest", 300),
			audio("oldest", 100),
			audio("gone", 200, true),
		]);
		state.completeScan();

		expect(state.status).toBe("ready");
		expect(state.keys).toEqual(["oldest", "newest"]);
		expect(state.enter()).toBe("newest");
		expect(state.ordinal).toBe("2 of 2");
		expect(state.selectOlder()).toBe("oldest");
		expect(state.selectOlder()).toBe("oldest");
		expect(state.selectNewer()).toBe("newest");
		expect(state.selectNewer()).toBe("newest");
	});

	it("distinguishes an exhausted empty history from an unavailable scan", () => {
		const empty = new VoiceNoteNavigatorState();
		empty.beginScan();
		empty.completeScan();
		expect(empty.status).toBe("empty");

		const unavailable = new VoiceNoteNavigatorState();
		unavailable.beginScan();
		unavailable.failScan();
		expect(unavailable.status).toBe("unavailable");
	});

	it("removes retracted entries and exits without changing selection", () => {
		const state = new VoiceNoteNavigatorState();
		state.merge([audio("one", 1), audio("two", 2)]);
		state.completeScan();
		state.enter();
		state.merge([audio("one", 1), audio("two", 2, true)]);
		expect(state.keys).toEqual(["one"]);
		expect(state.selectedKey).toBe("one");
		state.exit();
		expect(state.active).toBe(false);
		expect(state.selectedKey).toBe("one");
	});
});
