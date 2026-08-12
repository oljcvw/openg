import { describe, expect, it } from "vitest";

import { fullConversationSchema } from "$lib/model/messaging/conversations";

function conversation(metadata?: unknown) {
	return {
		type: "full_conversation_v1",
		data: {
			conversationId: "conversation",
			name: "Peer",
			participants: [
				{
					profileId: 2,
					primaryMediaHash: null,
					lastOnline: null,
					onlineUntil: null,
					distanceMetres: null,
					position: null,
					isInAList: false,
					hasDatingPotential: false,
				},
			],
			lastActivityTimestamp: 1,
			unreadCount: 0,
			preview: null,
			muted: false,
			pinned: false,
			favorite: false,
			rightNow: "NOT_ACTIVE",
			onlineUntil: null,
			hasUnreadThrob: false,
			...(metadata === undefined ? {} : { metadata }),
		},
	};
}

describe("conversation shared-album hint", () => {
	it("keeps old cached conversations valid without fabricating absence", () => {
		const parsed = fullConversationSchema.parse(conversation());
		expect(parsed.data.metadata).toBeUndefined();
	});

	it.each([true, false, null])(
		"parses %s as a boolean-or-null hint",
		(hint) => {
			const parsed = fullConversationSchema.parse(
				conversation({ hasSharedAlbums: hint }),
			);
			expect(parsed.data.metadata?.hasSharedAlbums).toBe(hint);
		},
	);
});
