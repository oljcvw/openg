import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import z from "zod";

import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";

const apiRuntimeStatusSchema = z.object({
	sequence: z.number().int().nonnegative(),
	phase: z.enum(["recovering", "cooldown", "probing", "recovered", "healthy"]),
	reason: z.enum(["circuit", "protection"]),
	requestClass: z.string(),
	route: z.string(),
	attempt: z.number().int().nonnegative(),
	retryAtMs: z.number().int().nonnegative().nullable(),
	cooldownLevel: z.number().int().nonnegative(),
	activeRequests: z.number().int().nonnegative(),
	queuedRequests: z.number().int().nonnegative(),
});

export type ApiRuntimeStatus = z.infer<typeof apiRuntimeStatusSchema>;

export function isProfileOnlyProtection(
	status: Pick<ApiRuntimeStatus, "reason" | "requestClass"> | null | undefined,
): boolean {
	return (
		status?.reason === "protection" &&
		status.requestClass === "browseProfileBatch"
	);
}

class ApiHealthState {
	status: ApiRuntimeStatus | null = $state(null);
	nowMs = $state(Date.now());
	#recoveredTimer: ReturnType<typeof setTimeout> | null = null;
	#lastSequence = -1;

	get retrySeconds(): number | null {
		if (this.status?.retryAtMs == null) return null;
		return Math.max(0, Math.ceil((this.status.retryAtMs - this.nowMs) / 1000));
	}

	accept(payload: unknown): void {
		const parsed = apiRuntimeStatusSchema.safeParse(payload);
		if (!parsed.success) return;
		if (parsed.data.sequence <= this.#lastSequence) return;
		this.#lastSequence = parsed.data.sequence;
		if (this.#recoveredTimer !== null) clearTimeout(this.#recoveredTimer);
		this.status = parsed.data.phase === "healthy" ? null : parsed.data;
		if (parsed.data.phase === "recovered") {
			const sequence = parsed.data.sequence;
			this.#recoveredTimer = setTimeout(() => {
				if (this.status?.sequence === sequence) this.status = null;
				this.#recoveredTimer = null;
			}, 4000);
		}
	}

	reset(): void {
		if (this.#recoveredTimer !== null) clearTimeout(this.#recoveredTimer);
		this.#recoveredTimer = null;
		this.status = null;
		this.nowMs = Date.now();
		this.#lastSequence = -1;
	}
}

export const apiHealthState = new ApiHealthState();

export function registerApiHealthListener(): () => void {
	if (!isTauri()) return () => {};
	const interval = window.setInterval(() => {
		apiHealthState.nowMs = Date.now();
	}, 1000);
	const unlisten = listen("api:runtime-status", (event) => {
		apiHealthState.accept(event.payload);
	}).catch((error: unknown) => {
		reportClientDiagnostic({
			category: "listener_error",
			component: "api_health",
			code: error instanceof Error ? "listener_failed" : "listener_rejected",
			level: "error",
		});
		return () => {};
	});
	return () => {
		window.clearInterval(interval);
		void unlisten.then((release) => release());
		apiHealthState.reset();
	};
}
