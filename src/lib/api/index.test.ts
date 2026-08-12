import { encode } from "@msgpack/msgpack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

import { activateAccountSession } from "$lib/api/account-caches";
import { toBase64 } from "$lib/util/base64";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: vi.fn(() => ({
		apiRequestTimeoutMs: 35_000,
		profileResolutionBatchSize: 30,
		profileResolutionWindowMs: 16,
	})),
}));

import {
	asAppError,
	asBanned,
	banInfoSchema,
	fetchRest,
	parseApiResponse,
	restrictionSchema,
} from "$lib/api";

beforeEach(() => {
	activateAccountSession(1);
	invokeMock.mockReset();
});
afterEach(() => vi.useRealTimers());

function packedResponse(status = 200, text = "ok"): string {
	return toBase64(encode({ status, body: new TextEncoder().encode(text) }));
}

describe("safe request coalescing", () => {
	it("shares identical safe reads while they are in flight", async () => {
		let resolveRequest!: (value: string) => void;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise<string>((resolve) => {
					resolveRequest = resolve;
				}),
		);

		const first = fetchRest("/v4/cascade?page=1");
		const second = fetchRest("/v4/cascade?page=1");
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());

		resolveRequest(packedResponse());
		expect((await first).text()).toBe("ok");
		expect((await second).text()).toBe("ok");
	});

	it("keeps distinct safe request bodies separate", async () => {
		invokeMock.mockResolvedValue(packedResponse());
		await Promise.all([
			fetchRest("/v3/profiles", {
				method: "POST",
				body: { targetProfileIds: [1] },
			}),
			fetchRest("/v3/profiles", {
				method: "POST",
				body: { targetProfileIds: [2] },
			}),
		]);
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("removes rejected safe requests so a later attempt can run", async () => {
		invokeMock
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(packedResponse());
		await expect(fetchRest("/v4/cascade?page=1")).rejects.toThrow("offline");
		expect((await fetchRest("/v4/cascade?page=1")).text()).toBe("ok");
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("times out and cancels a native request whose invoke never settles", async () => {
		vi.useFakeTimers();
		invokeMock.mockImplementation((command: string) => {
			if (command === "request") return new Promise(() => {});
			if (command === "cancel_request") return Promise.resolve(true);
			return Promise.reject(new Error(`Unexpected command: ${command}`));
		});
		const first = fetchRest("/v4/cascade?page=1");
		for (
			let index = 0;
			index < 10 && invokeMock.mock.calls.length === 0;
			index++
		) {
			await Promise.resolve();
		}
		expect(invokeMock).toHaveBeenCalledTimes(1);

		const failed = expect(first).rejects.toThrow("API request timed out");
		await vi.advanceTimersByTimeAsync(35_000);
		await failed;
		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(invokeMock).toHaveBeenLastCalledWith(
			"cancel_request",
			expect.objectContaining({ requestId: expect.any(String) }),
		);
	});

	it("keeps a shared native request alive when one subscriber aborts", async () => {
		let resolveRequest!: (value: string) => void;
		invokeMock.mockImplementation((command: string) =>
			command === "request"
				? new Promise<string>((resolve) => {
						resolveRequest = resolve;
					})
				: Promise.resolve(true),
		);
		const controller = new AbortController();
		const first = fetchRest("/v4/cascade?page=1", {
			signal: controller.signal,
		});
		const second = fetchRest("/v4/cascade?page=1");
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
		controller.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(invokeMock).toHaveBeenCalledTimes(1);
		resolveRequest(packedResponse());
		expect((await second).text()).toBe("ok");
	});

	it("cancels a shared native request after every subscriber aborts", async () => {
		invokeMock.mockImplementation((command: string) =>
			command === "request" ? new Promise(() => {}) : Promise.resolve(true),
		);
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = fetchRest("/v4/cascade?page=1", {
			signal: firstController.signal,
		});
		const second = fetchRest("/v4/cascade?page=1", {
			signal: secondController.signal,
		});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
		firstController.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(invokeMock).toHaveBeenCalledTimes(1);
		secondController.abort();
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
		expect(invokeMock.mock.calls[1]?.[0]).toBe("cancel_request");
	});

	it("never coalesces mutations", async () => {
		invokeMock.mockResolvedValue(packedResponse());
		await Promise.all([
			fetchRest("/v4/chat/message/send", { method: "POST", body: { a: 1 } }),
			fetchRest("/v4/chat/message/send", { method: "POST", body: { a: 1 } }),
		]);
		expect(invokeMock).toHaveBeenCalledTimes(2);
	});

	it("does not share a safe request across account generations", async () => {
		let resolveFirst!: (value: string) => void;
		invokeMock.mockImplementation((command: string) => {
			if (command === "cancel_request") return Promise.resolve(true);
			if (
				invokeMock.mock.calls.filter(([name]) => name === "request").length ===
				1
			) {
				return new Promise<string>((resolve) => {
					resolveFirst = resolve;
				});
			}
			return Promise.resolve(packedResponse(200, "account-b"));
		});
		const first = fetchRest("/v4/cascade?page=1");
		await vi.waitFor(() =>
			expect(
				invokeMock.mock.calls.filter(([name]) => name === "request"),
			).toHaveLength(1),
		);

		activateAccountSession(2);
		const second = fetchRest("/v4/cascade?page=1");
		expect((await second).text()).toBe("account-b");
		resolveFirst(packedResponse(200, "account-a"));
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(
			invokeMock.mock.calls.filter(([name]) => name === "request"),
		).toHaveLength(2);
	});
});

describe("asAppError", () => {
	it("formats string messages from structured app errors", () => {
		expect(asAppError({ kind: "Auth", message: "Not logged in" })).toEqual({
			kind: "Auth",
			message: "Not logged in",
			prettyMessage: "Not logged in",
		});
	});

	it("formats API error code objects from structured app errors", () => {
		expect(
			asAppError({
				kind: "Api",
				message: { code: 429, message: "Rate limited" },
			}),
		).toEqual({
			kind: "Api",
			message: { code: 429, message: "Rate limited" },
			prettyMessage: "Error 429: Rate limited",
		});
	});

	it("ignores unknown errors", () => {
		expect(asAppError(new Error("network failed"))).toBeUndefined();
	});

	it("formats request cooldown errors", () => {
		expect(
			asAppError({
				kind: "RequestCooldown",
				message: { retryAtMs: 1234 },
			}),
		).toEqual({
			kind: "RequestCooldown",
			message: { retryAtMs: 1234 },
			prettyMessage: "Requests are temporarily paused",
		});
	});
});

describe("simulated account-status responses", () => {
	const bannedError = {
		kind: "Banned",
		message: {
			kind: "profile",
			code: 27,
			message: "Profile is banned",
			reason: null,
			subReason: "DRUG_SALES",
			automated: true,
		},
	};

	it("extracts ban details from a Banned app error", () => {
		const ban = asBanned(bannedError);
		expect(ban?.kind).toBe("profile");
		expect(ban?.code).toBe(27);
		expect(ban?.subReason).toBe("DRUG_SALES");
		expect(ban?.automated).toBe(true);
	});

	it("classifies Banned and RateLimited kinds", () => {
		expect(asAppError(bannedError)?.kind).toBe("Banned");
		expect(asAppError({ kind: "RateLimited" })?.kind).toBe("RateLimited");
	});

	it("does not treat a non-ban error as banned", () => {
		expect(
			asBanned({ kind: "Unauthorized", message: { code: 401, message: "x" } }),
		).toBeNull();
	});

	it("parses an age-verification restriction", () => {
		const restriction = restrictionSchema.parse({
			kind: "ageVerification",
			region: "uk",
			reason: "UK_VERIFICATION_REQUIRED",
		});
		expect(restriction.kind).toBe("ageVerification");
		expect(restriction.region).toBe("uk");
	});

	it("parses an auth:banned event payload", () => {
		const info = banInfoSchema.parse({
			kind: "device",
			code: 28,
			message: "ACCOUNT_BANNED",
			reason: null,
			subReason: null,
			automated: null,
		});
		expect(info.kind).toBe("device");
		expect(info.code).toBe(28);
	});
});

describe("parseApiResponse", () => {
	it("returns schema-parsed response data", () => {
		const parsed = parseApiResponse({
			path: "/v8/sessions",
			method: "POST",
			schema: z.object({
				profileId: z.coerce.number().int().nonnegative(),
			}),
			data: { profileId: "123" },
		});

		expect(parsed).toEqual({ profileId: 123 });
	});

	it("logs endpoint context before throwing validation errors", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		expect(() =>
			parseApiResponse({
				path: "/v5/chat/conversation/abc/message",
				method: "GET",
				schema: z.object({
					messages: z.array(z.object({ messageId: z.string() })),
				}),
				data: { messages: [{ messageId: 123 }] },
			}),
		).toThrow(z.ZodError);

		expect(consoleError).toHaveBeenCalledWith(
			"API response schema validation failed",
			expect.objectContaining({
				method: "GET",
				issueCount: 1,
			}),
		);
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain("abc");
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain("123");

		consoleError.mockRestore();
	});
});
