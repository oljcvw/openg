import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";

export type DiagnosticLevel = "info" | "warning" | "error";

export type ClientDiagnostic = {
	category: string;
	component: string;
	code: string;
	level: DiagnosticLevel;
};

const recentUserErrors = new Map<string, number>();

function diagnosticCode(error: unknown): string {
	if (error && typeof error === "object" && "kind" in error) {
		const kind = String(error.kind).replaceAll(/[^a-z0-9_-]/gi, "_");
		return `api_${kind}`.slice(0, 48);
	}
	return error instanceof Error ? "javascript_error" : "unknown_error";
}

export function reportClientDiagnostic(diagnostic: ClientDiagnostic): void {
	if (!isTauri()) return;
	void invoke("report_client_diagnostic", { diagnostic }).catch(() => {
		// Diagnostics must never interfere with application behavior.
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
		level: "error",
	});
	toast.error("Something went wrong", {
		description: "The error was recorded for diagnostics.",
		id: `unexpected-error-${source}`,
	});
}

export function registerGlobalErrorReporting(): () => void {
	const onError = (event: ErrorEvent) => {
		showUnexpectedError(event.error ?? event.message, "window_error");
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
