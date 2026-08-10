import { registerAccountCache } from "$lib/api/account-caches";
import { sendMessage, sendReplyMessage } from "$lib/api/messaging/messages";
import type { Message } from "$lib/model/messaging/messages";

export type DirectMessageDeliveryState =
	| "idle"
	| "sending"
	| "sent"
	| "confirming"
	| "failed";

export type DirectMessageSendRequest = {
	message: Message;
	attemptRef: string;
	commandRef: string;
	replyToMessageId?: string;
};

type SendOutcome = Awaited<ReturnType<typeof sendMessage>>;

/** Shared acknowledgement and command-deduplication path for all composers. */
export class DirectMessageSession {
	deliveryState: DirectMessageDeliveryState = "idle";
	readonly #toUserId: number;
	readonly #operations = new Map<string, Promise<SendOutcome>>();

	constructor(toUserId: number) {
		this.#toUserId = toUserId;
	}

	send(request: DirectMessageSendRequest): Promise<SendOutcome> {
		const existing = this.#operations.get(request.commandRef);
		if (existing) return existing;
		this.deliveryState = "sending";
		const operation = (
			request.replyToMessageId
				? sendReplyMessage({
						toUserId: this.#toUserId,
						message: request.message,
						replyToMessageId: request.replyToMessageId,
						ref: request.attemptRef,
						commandRef: request.commandRef,
					})
				: sendMessage({
						toUserId: this.#toUserId,
						message: request.message,
						ref: request.attemptRef,
						commandRef: request.commandRef,
					})
		)
			.then((outcome) => {
				this.deliveryState =
					outcome.kind === "ack"
						? "sent"
						: outcome.kind === "unknown"
							? "confirming"
							: "failed";
				return outcome;
			})
			.catch((error) => {
				this.deliveryState = "failed";
				// Keep in-flight and acknowledged commands deduplicated, but allow an
				// explicit retry after a transport failure to reuse the stable command
				// reference. The server-side command id remains the final dedupe guard.
				this.#operations.delete(request.commandRef);
				throw error;
			});
		this.#operations.set(request.commandRef, operation);
		if (this.#operations.size > 128) {
			const oldest = this.#operations.keys().next().value;
			if (oldest !== undefined) this.#operations.delete(oldest);
		}
		return operation;
	}
}

const sessions = new Map<string, DirectMessageSession>();

export function getDirectMessageSession({
	accountProfileId,
	conversationId,
	toUserId,
}: {
	accountProfileId: number;
	conversationId: string;
	toUserId: number;
}): DirectMessageSession {
	const key = `${accountProfileId}:${conversationId}`;
	let session = sessions.get(key);
	if (!session) {
		session = new DirectMessageSession(toUserId);
		sessions.set(key, session);
	}
	return session;
}

export function clearDirectMessageSessions(): void {
	sessions.clear();
}

registerAccountCache(clearDirectMessageSessions);
