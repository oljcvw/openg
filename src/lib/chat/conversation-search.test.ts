import { describe, expect, it } from "vitest";

import type { Conversation } from "$lib/model/messaging/conversations";
import type { ApiResponseMessage } from "$lib/model/messaging/messages";
import {
	compileConversationSearch,
	conversationMatchesSearch,
	messageSearchChunks,
	searchMatchPreview,
} from "./conversation-search";

function conversation({
	name = "Alex",
	previewText = "Dinner tomorrow?",
}: { name?: string; previewText?: string | null } = {}): Conversation {
	return {
		data: {
			name,
			preview: previewText === null ? null : { text: previewText },
		},
	} as Conversation;
}

describe("conversationMatchesSearch", () => {
	it("matches conversation names case-insensitively", () => {
		expect(conversationMatchesSearch(conversation(), "aLeX")).toBe(true);
	});

	it("matches words in the latest text preview", () => {
		expect(conversationMatchesSearch(conversation(), "tomorrow")).toBe(
			true,
		);
	});

	it("allows terms to match across the name and preview", () => {
		expect(conversationMatchesSearch(conversation(), "alex dinner")).toBe(
			true,
		);
	});

	it("requires every search term to match", () => {
		expect(
			conversationMatchesSearch(conversation(), "alex breakfast"),
		).toBe(false);
	});

	it("treats surrounding and repeated whitespace as insignificant", () => {
		expect(
			conversationMatchesSearch(conversation(), "  alex   tomorrow  "),
		).toBe(true);
	});

	it("matches every conversation for an empty query", () => {
		expect(conversationMatchesSearch(conversation(), "   ")).toBe(true);
	});

	it("handles conversations without a preview", () => {
		expect(
			conversationMatchesSearch(
				conversation({ previewText: null }),
				"dinner",
			),
		).toBe(false);
	});

	it("matches accents using their unaccented spelling", () => {
		expect(
			conversationMatchesSearch(conversation({ name: "José" }), "jose"),
		).toBe(true);
	});

	it("accepts a compiled query and cached history chunks", () => {
		expect(
			conversationMatchesSearch(
				conversation(),
				compileConversationSearch("alex archived"),
				["an archived message"],
			),
		).toBe(true);
	});
});

describe("messageSearchChunks", () => {
	function message(
		type: "Text" | "AlbumContentReply" | "ProfilePhotoReply",
		body: unknown,
	): ApiResponseMessage {
		return { type, body } as ApiResponseMessage;
	}

	it("indexes every modeled user-written message field", () => {
		expect(messageSearchChunks(message("Text", { text: "Hello" }))).toEqual(
			["hello"],
		);
		expect(
			messageSearchChunks(
				message("AlbumContentReply", {
					albumContentReply: "Great album",
				}),
			),
		).toEqual(["great album"]);
		expect(
			messageSearchChunks(
				message("ProfilePhotoReply", {
					photoContentReply: "Nice photo",
				}),
			),
		).toEqual(["nice photo"]);
	});
});

describe("searchMatchPreview", () => {
	it("centers a long preview around the normalized match", () => {
		const preview = searchMatchPreview(
			`${"before ".repeat(30)}José's nebula handshake ${"after ".repeat(30)}`,
			["jose", "nebula"],
			80,
		);

		expect(preview).toContain("José's nebula handshake");
		expect(preview.startsWith("…")).toBe(true);
		expect(preview.endsWith("…")).toBe(true);
	});
});
