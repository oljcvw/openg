import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";

import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
export type DiagnosticLevel = "info" | "warning" | "error";

export type ClientDiagnostic = {
	category: string;
	component: string;
	code: string;
	level: DiagnosticLevel;
};

export type BackgroundTaskDiagnostic = {
	category: string;
	component: string;
	code: string;
	level?: DiagnosticLevel;
};

export type ViewerDiagnostic = {
	event:
		| "open_requested"
		| "resolving"
		| "resolved"
		| "opened"
		| "item_loaded"
		| "item_failed"
		| "cancelled"
		| "closed"
		| "destroyed";
	surface: "chat" | "album" | "profile" | "received_albums";
	mediaKind: "image" | "video" | "mixed" | "none";
	cacheSource: "memory" | "local" | "network" | "none";
	access: "persistent" | "retained_limited" | "limited" | "none";
	countBucket: "one" | "few" | "many" | "none";
	positionBucket: "first" | "middle" | "last" | "none";
	latencyBucket: "instant" | "fast" | "slow" | "very_slow" | "none";
	failure:
		| "none"
		| "cancelled"
		| "decode"
		| "network"
		| "cache_miss"
		| "unavailable"
		| "stale_generation"
		| "unknown";
};

const recentUserErrors = new Map<string, number>();

export function diagnosticCode(error: unknown): string {
	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : "";
	if (/ResizeObserver loop limit exceeded/i.test(message))
		return "resize_observer_limit";
	if (/ResizeObserver loop completed with undelivered notifications/i.test(message))
		return "resize_observer_undelivered";
	if (error === undefined || error === null) return "empty_rejection";
	if (error && typeof error === "object" && "kind" in error) {
		const kind = String(error.kind).replaceAll(/[^a-z0-9_-]/gi, "_");
		return `api_${kind}`.slice(0, 48);
	}
	if (error instanceof Error) return "javascript_error";
	if (typeof error === "string") return "string_rejection";
	return typeof error === "object" ? "opaque_rejection" : "primitive_rejection";
}

function shouldPresentUnexpectedError(error: unknown): boolean {
	if (diagnosticCode(error).startsWith("resize_observer_")) return false;
	if (error === undefined || error === null) return false;
	return error instanceof Error || typeof error !== "object" || "kind" in error;
}

export function reportClientDiagnostic(diagnostic: ClientDiagnostic): void {
	if (!isTauri() || !getDeveloperSettingsSnapshot().logErrorsToLogcat) return;
	void invoke("report_client_diagnostic", { diagnostic }).catch(() => {
		// Diagnostics must never interfere with application behavior.
	});
}

export function reportViewerDiagnostic(diagnostic: ViewerDiagnostic): void {
	if (!isTauri() || !getDeveloperSettingsSnapshot().logErrorsToLogcat) return;
	void invoke("report_viewer_diagnostic", { diagnostic }).catch(() => {
		// Diagnostics must never interfere with viewer behavior.
	});
}

export function reportPresentedError(
	error: unknown,
	component: string,
	category = "presented_error",
): void {
	reportClientDiagnostic({
		category,
		component,
		code: diagnosticCode(error),
		level: "error",
	});
}

export function observeBackgroundTask(
	task: Promise<unknown>,
	diagnostic: BackgroundTaskDiagnostic,
): void {
	void task.catch(() => {
	reportClientDiagnostic({
			category: diagnostic.category,
			component: diagnostic.component,
			code: diagnostic.code,
			level: diagnostic.level ?? "warning",
		});
	});
}

function showUnexpectedError(error: unknown, source: string): void {
	const code = diagnosticCode(error);
	const key = `${source}:${code}`;
	const now = Date.now();
	if (now - (recentUserErrors.get(key) ?? 0) < 10_000) return;
	recentUserErrors.set(key, now);
		reportClientDiagnostic({
		category: "unexpected_error",
		component: source,
		code,
		level: shouldPresentUnexpectedError(error) ? "error" : "warning",
	});
	if (!shouldPresentUnexpectedError(error)) return;
	toast.error("Something went wrong", {
		description: "The error was recorded for diagnostics.",
		id: `unexpected-error-${source}`,
	});
}

export function registerGlobalErrorReporting(): () => void {
	const onError = (event: ErrorEvent) => {
		const basename = event.filename
			? event.filename
					.split(/[\\/]/)
					.at(-1)
					?.split(/[?#]/, 1)[0]
					?.replaceAll(/[^a-z0-9._-]/gi, "_")
					.slice(0, 48)
			: undefined;
		const position = [event.lineno, event.colno]
			.filter((value) => Number.isInteger(value) && value >= 0 && value <= 999999)
			.join(":");
		const source = ["window_error", basename, position]
			.filter(Boolean)
			.join(":")
			.slice(0, 96);
		showUnexpectedError(event.error ?? event.message, source);
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		showUnexpectedError(event.reason, "unhandled_rejection");
	};
	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	return () => {
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onUnhandledRejection);
	};
}
