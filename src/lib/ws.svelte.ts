import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "svelte-sonner";
import z from "zod";

import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { tapTypeSchema } from "$lib/model/interest/taps";
import { mediaHashPublicSchema } from "$lib/model/media";
import { apiResponseMessageSchema } from "$lib/model/messaging/messages";
import { unixTimestampMsSchema } from "$lib/model/types";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";

let listenerFailurePresented = false;

function listenerDiagnosticCode(eventType: string): string {
	return `subscribe_${eventType.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(
		0,
		64,
	);
}

function reportListenerFailure(eventType: string): void {
	const code = listenerDiagnosticCode(eventType);
	console.error("[ws] listener registration failed", { code });
	reportClientDiagnostic({
		category: "listener_error",
		component: "websocket",
		code,
		level: "error",
	});
	if (listenerFailurePresented) return;
	listenerFailurePresented = true;
	toast.error("Live updates unavailable", {
		description: "Open Grind will continue refreshing data from the server.",
		id: "websocket-listener-error",
	});
}

export const notificationEventSchema = z.object({
	type: z.string(),
	notificationId: z.string().nullable(),
	ref: z.string().nullable(),
	payload: z.unknown(),
});

export const chatV1MessageSentEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("chat.v1.message_sent"),
	payload: apiResponseMessageSchema,
});

export const chatV1ConversationDeleteEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.conversation.delete"),
		payload: z.object({
			conversationIds: z.array(z.string()),
		}),
	});

export const chatV1ConversationReadEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.conversation_read"),
		payload: z.object({
			conversationId: z.string(),
			profileId: z.coerce.number(),
			timestamp: unixTimestampMsSchema,
		}),
	});

export const chatV1RefreshDynamicEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.refresh_dynamic"),
		payload: z.object({
			conversationId: z.string(),
			messageType: z.string(),
		}),
	});

export const chatV1ConversationUpdateEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.conversation.update"),
		payload: z.object({ conversationIds: z.array(z.string()) }),
	});

export const chatV1MessageDeletedEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.message_deleted"),
		payload: z.unknown(),
	});

export const chatV1CacheBombInboxEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("chat.v1.cache_bomb.inbox"),
		payload: z.unknown(),
	});

export const tapV1TapSentEventSchema = notificationEventSchema.safeExtend({
	type: z.literal("tap.v1.tap_sent"),
	payload: z.object({
		timestamp: unixTimestampMsSchema,
		senderId: z.number(),
		recipientId: z.number(),
		tapType: tapTypeSchema.or(z.literal(3).transform(() => null)).nullable(),
		senderProfileImageHash: mediaHashPublicSchema.nullable(),
		senderDisplayName: z.string().nullable(),
		isMutual: z.boolean(),
	}),
});

export const viewedMeV1NewViewReceivedEventSchema =
	notificationEventSchema.safeExtend({
		type: z.literal("viewed_me.v1.new_view_received"),
		payload: z.object({
			viewedCount: z.int().nullable(),
			mostRecent: z
				.object({
					profileId: z.coerce.number().int().nonnegative(),
					photoHash: z.string().nullish(),
					timestamp: unixTimestampMsSchema,
				})
				.nullable(),
		}),
	});

export type ChatV1MessageSentEventPayload = z.infer<
	typeof chatV1MessageSentEventSchema
>;
export type TapV1TapSentEventPayload = z.infer<typeof tapV1TapSentEventSchema>;
export type ViewedMeV1NewViewReceivedEventPayload = z.infer<
	typeof viewedMeV1NewViewReceivedEventSchema
>;
export type ChatV1ConversationDeleteEventPayload = z.infer<
	typeof chatV1ConversationDeleteEventSchema
>;
export type ChatV1ConversationReadEventPayload = z.infer<
	typeof chatV1ConversationReadEventSchema
>;

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export type NativeWsRequestOutcome =
	| { kind: "ack"; payload: unknown }
	| { kind: "notSent"; error: Error }
	| {
			kind: "unknown";
			reason: "timeout" | "disconnect" | "ambiguousResponse";
	  };

class WsState {
	status = $state<WsStatus>("disconnected");

	constructor() {
		void this.#listen<void>("ws:connected", "connected", () => {
			this.status = "connected";
			console.log("[ws] connected");
		});

		void this.#listen<void>("ws:disconnected", "disconnected", () => {
			this.status = "disconnected";
		});

		void this.#listen<string>("ws:ws_error", "server_error", (event) => {
			void event.payload;
			console.error("[ws] server error");
			reportClientDiagnostic({
				category: "transport_error",
				component: "websocket",
				code: "server_error",
				level: "error",
			});
		});
	}

	#listen<T>(
		channel: string,
		eventType: string,
		handler: (event: { payload: T }) => void,
	): Promise<() => void> {
		return listen<T>(channel, handler).catch(() => {
			reportListenerFailure(eventType);
			return () => {};
		});
	}

	connect(): void {
		console.log("[ws] connecting...");
		invoke("ws_connect").catch(() => {
			console.error("[ws] connect failed");
			reportClientDiagnostic({
				category: "transport_error",
				component: "websocket",
				code: "connect_failed",
				level: "error",
			});
		});
	}

	onConnected(handler: () => void): Promise<() => void> {
		return this.#listen<void>("ws:connected", "connected", () => handler());
	}

	onEventsDropped(handler: (skipped: number) => void): Promise<() => void> {
		return this.#listen<number>(
			"ws:events-dropped",
			"events_dropped",
			(event) => {
				handler(event.payload);
			},
		);
	}

	send(type: string, payload: unknown): void {
		const ref_id = crypto.randomUUID();
		invoke("ws_send", { command: { type, ref_id, payload } }).catch(() => {
			console.error("[ws] send failed", { type });
			reportClientDiagnostic({
				category: "transport_error",
				component: "websocket",
				code: "send_failed",
				level: "error",
			});
		});
	}

	request<T>(type: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
		const ref_id = crypto.randomUUID();
		const responseType = `${type}.response`;
		const safeName = responseType.replaceAll(".", "_");
		const responseSchema = z.object({
			type: z.literal(responseType),
			ref: z.string(),
			status: z.number().int(),
			payload: z.unknown(),
		});
		const { apiRequestTimeoutMs } = getDeveloperSettingsSnapshot();

		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let unlisten: (() => void) | undefined;

			const finish = (result: { data: T } | { error: unknown }) => {
				if (settled) return;
				settled = true;
				if (timeout !== undefined) clearTimeout(timeout);
				unlisten?.();
				if ("data" in result) resolve(result.data);
				else {
					reject(
						result.error instanceof Error
							? result.error
							: new Error("WebSocket request failed"),
					);
				}
			};

			void listen<unknown>(`grindr:${safeName}`, (event) => {
				const envelope = responseSchema.safeParse(event.payload);
				if (!envelope.success || envelope.data.ref !== ref_id) return;
				if (envelope.data.status < 200 || envelope.data.status >= 300) {
					finish({
						error: new Error(
							`WebSocket request failed with status ${envelope.data.status}`,
						),
					});
					return;
				}
				const parsed = schema.safeParse(envelope.data.payload);
				if (!parsed.success) {
					finish({ error: new Error("Invalid WebSocket response payload") });
					return;
				}
				finish({ data: parsed.data });
			})
				.then((removeListener) => {
					unlisten = removeListener;
					if (settled) {
						removeListener();
						return;
					}
					timeout = setTimeout(() => {
						finish({ error: new Error("WebSocket request timed out") });
					}, apiRequestTimeoutMs);
					return invoke("ws_send", {
						command: { type, ref_id, payload },
					});
				})
				.catch((error: unknown) => finish({ error }));
		});
	}

	requestOutcome(
		type: string,
		payload: unknown,
		ref_id: string = crypto.randomUUID(),
	): Promise<NativeWsRequestOutcome> {
		const responseType = `${type}.response`;
		const safeName = responseType.replaceAll(".", "_");
		const responseSchema = z.object({
			type: z.literal(responseType),
			ref: z.string(),
			status: z.number().int(),
			payload: z.unknown(),
		});
		const { apiRequestTimeoutMs } = getDeveloperSettingsSnapshot();

		return new Promise((resolve) => {
			let settled = false;
			let enqueueAttempted = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const unlisteners: (() => void)[] = [];
			const finish = (outcome: NativeWsRequestOutcome) => {
				if (settled) return;
				settled = true;
				if (timeout !== undefined) clearTimeout(timeout);
				for (const unlisten of unlisteners.splice(0)) unlisten();
				resolve(outcome);
			};

			const responseListener = (event: { payload: unknown }) => {
				const envelope = responseSchema.safeParse(event.payload);
				if (!envelope.success || envelope.data.ref !== ref_id) return;
				if (envelope.data.status >= 200 && envelope.data.status < 300) {
					finish({ kind: "ack", payload: envelope.data.payload });
					return;
				}
				finish({
					kind: "notSent",
					error: new Error(
						`WebSocket request failed with status ${envelope.data.status}`,
					),
				});
			};

			void listen<unknown>(`grindr:${safeName}`, responseListener)
				.then((removeResponseListener) => {
					unlisteners.push(removeResponseListener);
					if (settled) {
						for (const unlisten of unlisteners.splice(0)) unlisten();
						return;
					}
					return listen<void>("ws:disconnected", () => {
						finish({ kind: "unknown", reason: "disconnect" });
					});
				})
				.then((removeDisconnectListener) => {
					if (!removeDisconnectListener) return;
					unlisteners.push(removeDisconnectListener);
					if (settled) {
						for (const unlisten of unlisteners.splice(0)) unlisten();
						return;
					}
					timeout = setTimeout(
						() => finish({ kind: "unknown", reason: "timeout" }),
						apiRequestTimeoutMs,
					);
					enqueueAttempted = true;
					return invoke("ws_send", {
						command: { type, ref_id, payload },
					});
				})
				.catch((error: unknown) => {
					const failure =
						error instanceof Error ? error : new Error("WebSocket send failed");
					finish(
						enqueueAttempted
							? { kind: "unknown", reason: "ambiguousResponse" }
							: { kind: "notSent", error: failure },
					);
				});
		});
	}

	on<T>(
		eventType: string,
		schema: z.ZodType<T>,
		handler: (payload: T) => void,
	): Promise<() => void> {
		const safeName = eventType.replaceAll(".", "_");
		return this.#listen<unknown>(`grindr:${safeName}`, eventType, (event) => {
			const result = schema.safeParse(event.payload);
			if (result.success) {
				handler(result.data);
			} else {
				console.error(`[ws] unexpected payload for ${eventType}`, {
					issueCount: result.error.issues.length,
					issueCodes: [
						...new Set(result.error.issues.map((issue) => issue.code)),
					].sort(),
				});
			}
		});
	}
}

export const ws = new WsState();
