import {
	isRealtimeCommandResponse,
	parseRealtimeCommandResponse,
	parseRealtimeEvent,
	type RealtimeCommandResponse,
	type RealtimeEvent,
} from "$lib/realtime/events";

export type RealtimeConnectionState = "idle" | "connecting" | "open" | "closed";

export interface RealtimeTransport {
	connect(): Promise<void>;
	send(message: string): Promise<void>;
	close(code?: number, reason?: string): Promise<void>;
	onMessage(handler: (message: string) => void): () => void;
	onClose(
		handler: (event: { code?: number; reason?: string }) => void,
	): () => void;
}

type RealtimeClientOptions = {
	transport: RealtimeTransport;
	getToken: () => Promise<string>;
	commandTimeoutMs?: number;
	makeRef?: () => string;
	onError?: (error: unknown) => void;
};

type PendingCommand = {
	resolve: (response: RealtimeCommandResponse) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

function defaultRef() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class RealtimeClient {
	#transport: RealtimeTransport;
	#getToken: () => Promise<string>;
	#makeRef: () => string;
	#commandTimeoutMs: number;
	#onError?: (error: unknown) => void;
	#state: RealtimeConnectionState = "idle";
	#pending = new Map<string, PendingCommand>();
	#eventHandlers = new Map<string, Set<(event: RealtimeEvent) => void>>();
	#unsubscribe: (() => void)[];

	constructor({
		transport,
		getToken,
		commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
		makeRef = defaultRef,
		onError,
	}: RealtimeClientOptions) {
		this.#transport = transport;
		this.#getToken = getToken;
		this.#makeRef = makeRef;
		this.#commandTimeoutMs = commandTimeoutMs;
		this.#onError = onError;
		this.#unsubscribe = [
			this.#transport.onMessage((message) => this.#handleMessage(message)),
			this.#transport.onClose((event) => this.#handleClose(event)),
		];
	}

	get state() {
		return this.#state;
	}

	async connect() {
		if (this.#state === "open") return;
		this.#state = "connecting";
		await this.#transport.connect();
		this.#state = "open";
	}

	async close(code?: number, reason?: string) {
		await this.#transport.close(code, reason);
		this.#dispose();
	}

	on(type: string, handler: (event: RealtimeEvent) => void) {
		const handlers = this.#eventHandlers.get(type) ?? new Set();
		handlers.add(handler);
		this.#eventHandlers.set(type, handlers);
		return () => handlers.delete(handler);
	}

	async command(
		type: string,
		payload: unknown,
	): Promise<RealtimeCommandResponse> {
		if (this.#state !== "open") {
			throw new Error("Realtime connection is not open");
		}

		const ref = this.#makeRef();
		const response = new Promise<RealtimeCommandResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#pending.delete(ref);
				reject(new Error(`Timed out waiting for realtime response ${ref}`));
			}, this.#commandTimeoutMs);
			this.#pending.set(ref, { resolve, reject, timeout });
		});

		void this.#sendCommand(type, ref, payload);

		return response;
	}

	async #sendCommand(type: string, ref: string, payload: unknown) {
		try {
			const token = await this.#getToken();
			if (this.#state !== "open") return;
			await this.#transport.send(
				JSON.stringify({
					type,
					ref,
					token,
					payload,
				}),
			);
		} catch (error) {
			this.#rejectPending(
				ref,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	#rejectPending(ref: string, error: Error) {
		const pending = this.#pending.get(ref);
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.#pending.delete(ref);
		pending.reject(error);
	}

	#handleMessage(message: string) {
		let event: RealtimeEvent;
		try {
			event = parseRealtimeEvent(message);
		} catch (error) {
			this.#onError?.(error);
			return;
		}

		if (isRealtimeCommandResponse(event)) {
			this.#handleCommandResponse(event);
			return;
		}

		for (const handler of this.#eventHandlers.get(event.type) ?? []) {
			handler(event);
		}
	}

	#handleCommandResponse(event: RealtimeEvent) {
		let response: RealtimeCommandResponse;
		try {
			response = parseRealtimeCommandResponse(event);
		} catch (error) {
			this.#onError?.(error);
			return;
		}

		const pending = this.#pending.get(response.ref);
		if (!pending) return;

		clearTimeout(pending.timeout);
		this.#pending.delete(response.ref);
		pending.resolve(response);
	}

	#handleClose(event: { code?: number; reason?: string }) {
		this.#state = "closed";
		for (const [ref, pending] of this.#pending) {
			clearTimeout(pending.timeout);
			pending.reject(
				new Error(
					`Realtime connection closed before response for ref ${ref}${
						event.reason ? `: ${event.reason}` : ""
					}`,
				),
			);
		}
		this.#pending.clear();
	}

	#dispose() {
		for (const unsubscribe of this.#unsubscribe) unsubscribe();
		this.#unsubscribe = [];
	}
}
