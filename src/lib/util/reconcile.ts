import { callMethod } from "$lib/api";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import {
	chatV1CacheBombInboxEventSchema,
	chatV1ConversationUpdateEventSchema,
	chatV1MessageDeletedEventSchema,
	chatV1RefreshDynamicEventSchema,
	ws,
} from "$lib/ws.svelte";

export type ReconcileScope = "inbox" | "conversation" | "taps" | "views";
export type ReconcileReason =
	| "reconnected"
	| "events-dropped"
	| "foreground"
	| "server-signal";

export type ReconcileEvent = {
	reasons: ReadonlySet<ReconcileReason>;
	scopes: ReadonlySet<ReconcileScope>;
	allConversations: boolean;
	conversationIds: ReadonlySet<string>;
};

export type ReconcileHandler = (event: ReconcileEvent) => void | Promise<void>;

const ALL_SCOPES: readonly ReconcileScope[] = [
	"inbox",
	"conversation",
	"taps",
	"views",
];

class Reconciler {
	#handlers = new Set<{
		scopes: ReadonlySet<ReconcileScope>;
		handler: ReconcileHandler;
	}>();
	#lastReconcileAt = 0;
	#drainPromise: Promise<void> | null = null;
	#wasHidden = false;
	#firstConnect = true;
	#pendingReasons = new Set<ReconcileReason>();
	#pendingScopes = new Set<ReconcileScope>();
	#pendingAllConversations = false;
	#pendingConversationIds = new Set<string>();

	constructor() {
		ws.onConnected(() => {
			if (this.#firstConnect) {
				this.#firstConnect = false;
				return;
			}
			this.request("reconnected");
		}).catch(console.error);

		ws.onEventsDropped((skipped) => {
			console.warn(`[ws] resyncing after ${skipped} dropped events`);
			this.request("events-dropped");
		}).catch(console.error);

		ws.on(
			"chat.v1.refresh_dynamic",
			chatV1RefreshDynamicEventSchema,
			(event) => {
				this.request(
					"server-signal",
					["inbox", "conversation"],
					[event.payload.conversationId],
				);
			},
		).catch(console.error);
		ws.on(
			"chat.v1.conversation.update",
			chatV1ConversationUpdateEventSchema,
			(event) => {
				this.request(
					"server-signal",
					["inbox", "conversation"],
					event.payload.conversationIds,
				);
			},
		).catch(console.error);
		ws.on("chat.v1.message_deleted", chatV1MessageDeletedEventSchema, () =>
			this.request("server-signal", ["inbox", "conversation"]),
		).catch(console.error);
		ws.on("chat.v1.cache_bomb.inbox", chatV1CacheBombInboxEventSchema, () =>
			this.request("server-signal", ["inbox"]),
		).catch(console.error);

		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "hidden") {
					this.#wasHidden = true;
					return;
				}
				if (!this.#wasHidden) return;
				this.#wasHidden = false;
				this.request("foreground");
			});
		}
	}

	subscribe(
		scopes: ReconcileScope | readonly ReconcileScope[],
		handler: ReconcileHandler,
	): () => void {
		const subscription = {
			scopes: new Set<ReconcileScope>(
				typeof scopes === "string" ? [scopes] : scopes,
			),
			handler,
		};
		this.#handlers.add(subscription);
		return () => this.#handlers.delete(subscription);
	}

	request(
		reason: ReconcileReason,
		scopes: readonly ReconcileScope[] = ALL_SCOPES,
		conversationIds: readonly string[] = [],
	): void {
		this.#pendingReasons.add(reason);
		for (const scope of scopes) this.#pendingScopes.add(scope);
		if (scopes.includes("conversation")) {
			if (conversationIds.length === 0) {
				this.#pendingAllConversations = true;
				this.#pendingConversationIds.clear();
			} else if (!this.#pendingAllConversations) {
				for (const id of conversationIds) {
					this.#pendingConversationIds.add(id);
				}
			}
		}
		this.#ensureDrain();
	}

	#ensureDrain(): void {
		if (this.#drainPromise !== null) return;
		const drain = this.#drain().finally(() => {
			if (this.#drainPromise === drain) this.#drainPromise = null;
			if (this.#pendingScopes.size > 0) this.#ensureDrain();
		});
		this.#drainPromise = drain;
	}

	async #drain(): Promise<void> {
		while (this.#pendingScopes.size > 0) {
			const throttleMs = getDeveloperSettingsSnapshot().reconcileThrottleMs;
			const wait = Math.max(this.#lastReconcileAt + throttleMs - Date.now(), 0);
			if (wait > 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, wait));
			}

			const event: ReconcileEvent = {
				reasons: new Set(this.#pendingReasons),
				scopes: new Set(this.#pendingScopes),
				allConversations: this.#pendingAllConversations,
				conversationIds: this.#pendingAllConversations
					? new Set()
					: new Set(this.#pendingConversationIds),
			};
			this.#pendingReasons.clear();
			this.#pendingScopes.clear();
			this.#pendingAllConversations = false;
			this.#pendingConversationIds.clear();
			this.#lastReconcileAt = Date.now();

			const profileId = await callMethod("auth_state").catch(() => null);
			if (profileId === null) continue;

			for (const subscription of [...this.#handlers]) {
				if (
					![...subscription.scopes].some((scope) => event.scopes.has(scope))
				) {
					continue;
				}
				try {
					await subscription.handler(event);
				} catch (error) {
					console.error("Reconcile handler failed", error);
				}
			}
		}
	}
}

export const reconciler = new Reconciler();
