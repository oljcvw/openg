import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";
import { goto } from "$app/navigation";
import z from "zod";

import {
	type AccountSessionSnapshot,
	getAccountSessionSnapshot,
	isAccountSessionCurrent,
	registerAccountCache,
} from "$lib/api/account-caches";
import { ApiError } from "$lib/api/api-error";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { demoCallMethod, demoEnabled, demoRoute } from "$lib/demo";
import { fromBase64, toBase64 } from "$lib/util/base64";

export const banInfoSchema = z.object({
	kind: z.string(),
	code: z.number(),
	message: z.string(),
	reason: z.string().nullish(),
	subReason: z.string().nullish(),
	automated: z.boolean().nullish(),
});
export type BanInfo = z.infer<typeof banInfoSchema>;

export const restrictionSchema = z.object({
	kind: z.enum(["ageVerification", "timedBan", "trustVendorRejected", "other"]),
	region: z.string().nullish(),
	reason: z.string().nullish(),
});
export type Restriction = z.infer<typeof restrictionSchema>;

export const notificationSettingsSchema = z.object({
	supported: z.boolean(),
	enabled: z.boolean(),
	messages: z.boolean(),
	taps: z.boolean(),
	showPreviews: z.boolean(),
	permission: z.enum(["granted", "denied", "unsupported"]),
	lastSuccessfulCheck: z.number().int().nonnegative().nullable(),
	lastError: z.string().nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const methods = {
	login: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	login_with_google: {
		request: z.undefined(),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	google_sign_in: {
		request: z.object({
			token: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	auth_state: {
		request: z.undefined(),
		response: z.int().nonnegative().nullable(),
	},
	account_restriction: {
		request: z.undefined(),
		response: restrictionSchema.nullish(),
	},
	refresh_token: {
		request: z.undefined(),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
			restriction: restrictionSchema.nullish(),
		}),
	},
	logout: {
		request: z.undefined(),
		response: z.undefined(),
	},
	recaptcha_first_party_enabled: {
		request: z.undefined(),
		response: z.boolean(),
	},
	api_runtime_configure: {
		request: z.object({
			apiCircuitFailurePercent: z.number().int().min(25).max(50),
			apiCircuitMinimumSamples: z.number().int().min(5).max(20),
			apiCircuitOpenMs: z.number().int().min(30_000).max(300_000),
			apiCircuitWindowSize: z.number().int().min(20).max(100),
			apiProtectionCooldownMs: z.number().int().min(30_000).max(300_000),
		}),
		response: z.undefined(),
	},
	notification_get_settings: {
		request: z.undefined(),
		response: notificationSettingsSchema,
	},
	notification_set_settings: {
		request: z.object({
			enabled: z.boolean(),
			messages: z.boolean(),
			taps: z.boolean(),
			showPreviews: z.boolean(),
		}),
		response: notificationSettingsSchema,
	},
	notification_test: {
		request: z.undefined(),
		response: z.undefined(),
	},
	notification_sync: {
		request: z.object({
			intervalMinutes: z.number().int().min(15).max(1_440),
		}),
		response: z.undefined(),
	},
	notification_cancel: {
		request: z.undefined(),
		response: z.undefined(),
	},
	validate_password_complexity: {
		request: z.object({ password: z.string().min(1).max(1024) }),
		response: z.undefined(),
	},
	update_account_password: {
		request: z.object({
			currentPassword: z.string().min(1).max(1024),
			newPassword: z.string().min(8).max(1024),
		}),
		response: z.object({
			remoteApplied: z.boolean(),
			localCleanupComplete: z.boolean(),
		}),
	},
	update_account_email: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1).max(1024),
		}),
		response: z.object({
			remoteApplied: z.boolean(),
			localCleanupComplete: z.boolean(),
		}),
	},
	delete_account: {
		request: z.undefined(),
		response: z.object({
			remoteApplied: z.boolean(),
			localCleanupComplete: z.boolean(),
		}),
	},
	notification_clear_account: {
		request: z.object({
			accountId: z.coerce.number().int().nonnegative(),
		}),
		response: z.undefined(),
	},
} satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export async function callMethod<T extends keyof typeof methods>(
	method: T,
	...args: z.infer<(typeof methods)[T]["request"]> extends undefined
		? []
		: [data: z.infer<(typeof methods)[T]["request"]>]
): Promise<z.infer<(typeof methods)[T]["response"]>> {
	if (demoEnabled) {
		return demoCallMethod(method) as z.infer<(typeof methods)[T]["response"]>;
	}
	return await invoke(method, args[0]);
}

export function asBanned(error: unknown): BanInfo | null {
	const parsed = z
		.object({ kind: z.literal("Banned"), message: banInfoSchema })
		.safeParse(error);
	return parsed.success ? parsed.data.message : null;
}

export function asAppError(error: unknown) {
	const { data, success } = z
		.object({
			kind: z.enum([
				"Http",
				"Auth",
				"NotLoggedIn",
				"Api",
				"Unauthorized",
				"Banned",
				"RateLimited",
				"RequestBlocked",
				"RequestCooldown",
				"RequestCancelled",
				"NotInitialized",
				"SessionCleared",
			]),
			message: z
				.string()
				.or(
					z.object({
						code: z.number(),
						message: z.string(),
					}),
				)
				.or(z.object({ retryAtMs: z.number().int().nonnegative() }))
				.optional(),
		})
		.safeParse(error);
	if (success) {
		let prettyMessage: string;
		if (typeof data.message === "string") {
			prettyMessage = data.message;
		} else if (data.message) {
			prettyMessage =
				"retryAtMs" in data.message
					? "Requests are temporarily paused"
					: `Error ${data.message.code}: ${data.message.message}`;
		} else {
			prettyMessage = "An unknown error occurred";
		}
		return { ...data, prettyMessage };
	}
}

type RequestInfo = { method: string; path: string; body: unknown };

function buildRestResponse(
	status: number,
	responseBody: Uint8Array,
	requestInfo: RequestInfo,
) {
	return {
		status,
		bytes() {
			return responseBody;
		},
		text() {
			return new TextDecoder().decode(responseBody);
		},
		assertOk() {
			if (status >= 200 && status < 300) {
				return;
			}
			const text = this.text();
			throw new ApiError({
				message: `API request failed with status ${status}`,
				request: requestInfo,
				response: { status, body: text },
			});
		},
		json() {
			const text = this.text();
			const responseInfo = { status, body: text };
			try {
				return JSON.parse(text);
			} catch (error) {
				console.error("Failed to parse API JSON response");
				throw new ApiError({
					message: "Failed to parse API response",
					request: requestInfo,
					response: responseInfo,
					cause: error,
				});
			}
		},
		jsonParsed<TSchema extends z.ZodType>(schema: TSchema) {
			const data = this.json();
			const bodyText = this.text();
			try {
				return parseApiResponse({
					schema,
					data,
					path: requestInfo.path,
					method: requestInfo.method,
				});
			} catch (error) {
				if (error instanceof ApiError) throw error;
				throw new ApiError({
					message:
						error instanceof Error
							? error.message
							: "API response validation failed",
					request: requestInfo,
					response: { status, body: bodyText },
					cause: error,
				});
			}
		},
		debugJsonParsed<TSchema extends z.ZodType>(schema: TSchema) {
			console.log(this.json());
			return this.jsonParsed(schema);
		},
	};
}

type RawRestResult = { status: number; responseBody: Uint8Array };

type SharedRestRequest = {
	key: string | null;
	requestId: string;
	session: AccountSessionSnapshot;
	promise: Promise<RawRestResult>;
	subscribers: number;
	settled: boolean;
	cancelRequested: boolean;
};

class RequestTimeoutError extends Error {
	constructor() {
		super("API request timed out");
		this.name = "RequestTimeoutError";
	}
}

class AccountSessionChangedError extends Error {
	constructor() {
		super("Account session changed");
		this.name = "AccountSessionChangedError";
	}
}

const safeRestRequests = new Map<string, SharedRestRequest>();
const activeRestRequests = new Map<string, SharedRestRequest>();
const COALESCING_SALT = crypto.getRandomValues(new Uint32Array(4));

function opaqueRequestDigest(material: Uint8Array): string {
	return Array.from(COALESCING_SALT, (salt) => {
		let hash = (0x811c9dc5 ^ salt) >>> 0;
		for (const byte of material) {
			hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	}).join("");
}

function safeRequestKey(
	method: string,
	path: string,
	body: unknown,
	session: AccountSessionSnapshot,
): string | null {
	const route = path.split("?", 1)[0];
	const safe =
		method === "GET" ||
		method === "HEAD" ||
		(method === "POST" && (route === "/v4/inbox" || route === "/v3/profiles"));
	if (!safe) return null;
	const material = encode({
		method,
		path,
		body: body ?? null,
		accountGeneration: session.generation,
	});
	return opaqueRequestDigest(material);
}

function requestId(): string {
	return crypto.randomUUID();
}

async function invokeRestRequest(
	requestId: string,
	method: string,
	path: string,
	body: unknown,
	session: AccountSessionSnapshot,
): Promise<RawRestResult> {
	const payload = encode({
		requestId,
		method,
		path,
		body: body === undefined ? null : encode(body),
	});
	const packed = await invoke("request", {
		// https://github.com/tauri-apps/tauri/issues/10573
		payload: toBase64(payload),
	}).then((res) => {
		if (typeof res === "string") {
			// https://github.com/tauri-apps/tauri/issues/10573
			return fromBase64(res);
		}
		throw new Error("Invalid response from backend");
	});
	const decoded = decode(packed);
	if (!isAccountSessionCurrent(session)) {
		throw new AccountSessionChangedError();
	}
	const { status, body: responseBody } = z
		.object({ status: z.number(), body: z.instanceof(Uint8Array) })
		.parse(decoded);
	return { status, responseBody };
}

function cancelSharedRequest(request: SharedRestRequest): void {
	if (request.settled || request.cancelRequested) return;
	request.cancelRequested = true;
	if (activeRestRequests.get(request.requestId) === request) {
		activeRestRequests.delete(request.requestId);
	}
	if (request.key !== null && safeRestRequests.get(request.key) === request) {
		safeRestRequests.delete(request.key);
	}
	void invoke("cancel_request", { requestId: request.requestId }).catch(() => {
		console.error("Failed to cancel native API request");
	});
}

function subscribeToRequest(
	request: SharedRestRequest,
	signal: AbortSignal | undefined,
): Promise<RawRestResult> {
	request.subscribers += 1;
	const { apiRequestTimeoutMs } = getDeveloperSettingsSnapshot();
	return new Promise<RawRestResult>((resolve, reject) => {
		let finished = false;
		const finish = (callback: () => void) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			request.subscribers -= 1;
			callback();
			if (request.subscribers === 0) cancelSharedRequest(request);
		};
		const onAbort = () => {
			finish(() => reject(new DOMException("Request aborted", "AbortError")));
		};
		const timeout = setTimeout(() => {
			finish(() => reject(new RequestTimeoutError()));
		}, apiRequestTimeoutMs);
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		request.promise.then(
			(value) => finish(() => resolve(value)),
			(error: unknown) =>
				finish(() =>
					reject(
						error instanceof Error
							? error
							: new Error("API request failed", { cause: error }),
					),
				),
		);
	});
}

function createSharedRequest(
	method: string,
	path: string,
	body: unknown,
	key: string | null,
): SharedRestRequest {
	const session = getAccountSessionSnapshot();
	const shared: SharedRestRequest = {
		key,
		requestId: requestId(),
		session,
		promise: Promise.resolve({ status: 0, responseBody: new Uint8Array() }),
		subscribers: 0,
		settled: false,
		cancelRequested: false,
	};
	shared.promise = invokeRestRequest(
		shared.requestId,
		method,
		path,
		body,
		session,
	).finally(() => {
		shared.settled = true;
		if (activeRestRequests.get(shared.requestId) === shared) {
			activeRestRequests.delete(shared.requestId);
		}
		if (key !== null && safeRestRequests.get(key) === shared) {
			safeRestRequests.delete(key);
		}
	});
	activeRestRequests.set(shared.requestId, shared);
	return shared;
}

function coalescedRestRequest(
	method: string,
	path: string,
	body: unknown,
	signal: AbortSignal | undefined,
): Promise<RawRestResult> {
	const session = getAccountSessionSnapshot();
	const key = safeRequestKey(method, path, body, session);
	if (key === null) {
		return subscribeToRequest(
			createSharedRequest(method, path, body, null),
			signal,
		);
	}
	let request = safeRestRequests.get(key);
	if (request === undefined) {
		request = createSharedRequest(method, path, body, key);
		safeRestRequests.set(key, request);
	}
	return subscribeToRequest(request, signal);
}

function cancelAllRestRequests(): void {
	for (const request of activeRestRequests.values())
		cancelSharedRequest(request);
	safeRestRequests.clear();
}

registerAccountCache(cancelAllRestRequests);

export async function fetchRest(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		signal?: AbortSignal;
		abortController?: AbortController;
	} = { method: "GET" },
) {
	const method = options.method ?? "GET";
	const requestInfo = {
		method,
		path,
		body: options.body,
	};
	if (demoEnabled) {
		const { status, body } = demoRoute(path, method, options.body);
		const responseBody = new TextEncoder().encode(JSON.stringify(body ?? null));
		return buildRestResponse(status, responseBody, requestInfo);
	}
	try {
		const signal = options.signal ?? options.abortController?.signal;
		const { status, responseBody } = await coalescedRestRequest(
			method,
			path,
			options.body,
			signal,
		);
		return buildRestResponse(status, responseBody, requestInfo);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			throw error;
		if (error instanceof AccountSessionChangedError) {
			throw new DOMException("Account session changed", "AbortError");
		}
		if (error instanceof RequestTimeoutError) {
			throw new ApiError({
				message: error.message,
				request: requestInfo,
				kind: "RequestTimeout",
				cause: error,
			});
		}
		if (error instanceof ApiError) throw error;
		const appError = asAppError(error);
		if (appError?.kind === "RequestCancelled") {
			throw new DOMException("Request aborted", "AbortError");
		}
		if (appError?.kind === "RequestBlocked") {
			throw new ApiError({
				message: "Grindr temporarily refused this request",
				request: requestInfo,
				response: { status: 403, body: "" },
				kind: "RequestBlocked",
				cause: error,
			});
		}
		if (appError?.kind === "RequestCooldown") {
			throw new ApiError({
				message: "Grindr requests are temporarily paused",
				request: requestInfo,
				response: null,
				kind: "RequestCooldown",
				cause: error,
			});
		}
		if (appError?.kind === "Auth" && appError.message === "Not logged in") {
			goto("/auth/sign-in").catch(() =>
				console.error("Failed to navigate to sign-in"),
			);
		}
		throw new ApiError({
			message:
				appError?.prettyMessage ??
				(error instanceof Error ? error.message : String(error)),
			request: requestInfo,
			response: null,
			kind: appError?.kind ?? null,
			cause: error,
		});
	}
}

export function parseApiResponse<TSchema extends z.ZodType>(options: {
	schema: TSchema;
	data: unknown;
	path: string;
	method?: string;
}): z.infer<TSchema> {
	const parsed = options.schema.safeParse(options.data);
	if (parsed.success) {
		return parsed.data;
	}

	console.error("API response schema validation failed", {
		method: options.method ?? "GET",
		schema: options.schema.meta()?.title,
		issueCount: parsed.error.issues.length,
	});

	throw parsed.error;
}

export { ApiError };
