import { describe, expect, it } from "vitest";

import {
	assertCurrentConversationDetailIdentity,
	conversationDetailKey,
	resolveConversationDetailOwner,
} from "./conversation-detail-identity";

describe("conversation detail identity", () => {
	it("changes ownership for a different conversation or account generation", () => {
		const original = conversationDetailKey({
			accountGeneration: 4,
			accountProfileId: 12,
			conversationId: "conversation-a",
		});

		expect(
			conversationDetailKey({
				accountGeneration: 4,
				accountProfileId: 12,
				conversationId: "conversation-b",
			}),
		).not.toBe(original);
		expect(
			conversationDetailKey({
				accountGeneration: 5,
				accountProfileId: 12,
				conversationId: "conversation-a",
			}),
		).not.toBe(original);
	});

	it("rejects malformed identities before creating an owner", () => {
		expect(() =>
			conversationDetailKey({
				accountGeneration: 4,
				accountProfileId: 12,
				conversationId: "",
			}),
		).toThrow(TypeError);
	});

	it("rejects a detail owner whose route data and active account disagree", () => {
		const identity = {
			accountGeneration: 4,
			accountProfileId: 12,
			conversationId: "conversation-a",
		};
		expect(() =>
			assertCurrentConversationDetailIdentity(identity, {
				accountId: 12,
				generation: 4,
			}),
		).not.toThrow();
		expect(() =>
			assertCurrentConversationDetailIdentity(identity, {
				accountId: 13,
				generation: 4,
			}),
		).toThrow(TypeError);
		expect(() =>
			assertCurrentConversationDetailIdentity(identity, {
				accountId: 12,
				generation: 5,
			}),
		).toThrow(TypeError);
	});

	it("withholds the detail owner while account session and route data disagree", () => {
		expect(
			resolveConversationDetailOwner({
				accountProfileId: 12,
				accountSession: { accountId: null, generation: 5 },
				conversationId: "conversation-a",
			}),
		).toBeNull();
		expect(
			resolveConversationDetailOwner({
				accountProfileId: 12,
				accountSession: { accountId: 13, generation: 6 },
				conversationId: "conversation-a",
			}),
		).toBeNull();

		const owner = resolveConversationDetailOwner({
			accountProfileId: 12,
			accountSession: { accountId: 12, generation: 7 },
			conversationId: "conversation-a",
		});
		expect(owner).toEqual({
			identity: {
				accountGeneration: 7,
				accountProfileId: 12,
				conversationId: "conversation-a",
			},
			key: '[7,12,"conversation-a"]',
		});
	});
});
