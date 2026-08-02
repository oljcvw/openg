import { afterEach, describe, expect, it, vi } from "vitest";

import {
	apiHealthState,
	isProfileOnlyProtection,
} from "$lib/api/api-health-state.svelte";

function status(
	sequence: number,
	phase: "recovering" | "cooldown" | "probing" | "recovered" | "healthy",
	retryAtMs: number | null = null,
) {
	return {
		sequence,
		phase,
		reason: "protection" as const,
		requestClass: "browse_cascade",
		route: "/v4/cascade?page",
		attempt: 1,
		retryAtMs,
		cooldownLevel: 0,
		activeRequests: 1,
		queuedRequests: 2,
	};
}

afterEach(() => {
	apiHealthState.reset();
	vi.useRealTimers();
});

describe("ApiHealthState", () => {
	it("ignores malformed and out-of-order events", () => {
		apiHealthState.accept(status(2, "recovering"));
		apiHealthState.accept(status(1, "cooldown", 5000));
		apiHealthState.accept({ phase: "probing" });

		expect(apiHealthState.status?.sequence).toBe(2);
		expect(apiHealthState.status?.phase).toBe("recovering");
	});

	it("derives a nonnegative cooldown countdown", () => {
		apiHealthState.nowMs = 1000;
		apiHealthState.accept(status(3, "cooldown", 3250));
		expect(apiHealthState.retrySeconds).toBe(3);

		apiHealthState.nowMs = 5000;
		expect(apiHealthState.retrySeconds).toBe(0);
	});

	it("dismisses recovery acknowledgement after four seconds", () => {
		vi.useFakeTimers();
		apiHealthState.accept(status(4, "recovered"));
		expect(apiHealthState.status?.phase).toBe("recovered");

		vi.advanceTimersByTime(3999);
		expect(apiHealthState.status?.phase).toBe("recovered");
		vi.advanceTimersByTime(1);
		expect(apiHealthState.status).toBeNull();
	});

	it("clears immediately on a healthy event", () => {
		apiHealthState.accept(status(5, "recovering"));
		apiHealthState.accept(status(6, "healthy"));
		expect(apiHealthState.status).toBeNull();
	});

	it("distinguishes profile-only protection from global mitigation", () => {
		const profileStatus = {
			...status(7, "cooldown"),
			requestClass: "browseProfileBatch",
		};
		const globalStatus = {
			...profileStatus,
			requestClass: "foregroundRead",
		};
		const circuitStatus = {
			...profileStatus,
			reason: "circuit" as const,
		};

		expect(isProfileOnlyProtection(profileStatus)).toBe(true);
		expect(isProfileOnlyProtection(globalStatus)).toBe(false);
		expect(isProfileOnlyProtection(circuitStatus)).toBe(false);
	});
});
