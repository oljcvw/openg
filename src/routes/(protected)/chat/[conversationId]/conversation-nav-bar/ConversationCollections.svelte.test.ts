import { describe, expect, it } from "vitest";

import { collectionOperationOwnsCompletion } from "./ConversationCollections.svelte";

const scope = {
	accountProfileId: 1,
	conversationId: "conversation-a",
	peerProfileId: 2,
	generation: 3,
};

describe("conversation collection operation ownership", () => {
	it("requires account conversation peer generation and token ownership", () => {
		expect(collectionOperationOwnsCompletion(scope, scope, 4, 4)).toBe(true);
		for (const current of [
			{ ...scope, accountProfileId: 9 },
			{ ...scope, conversationId: "conversation-b" },
			{ ...scope, peerProfileId: 9 },
			{ ...scope, generation: 9 },
		]) {
			expect(collectionOperationOwnsCompletion(scope, current, 4, 4)).toBe(
				false,
			);
		}
		expect(collectionOperationOwnsCompletion(scope, scope, 4, 5)).toBe(false);
		expect(collectionOperationOwnsCompletion(scope, scope, 4, null)).toBe(
			false,
		);
	});
});
