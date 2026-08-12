import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "svelte-sonner";

import { ApiError } from "$lib/api/api-error";
import { confirmCopyError } from "$lib/api/copy-error-confirm-state.svelte";
import { errorReport, type RedactionOptions } from "$lib/api/error-report";
import { reportPresentedError } from "$lib/platform/client-diagnostics";

export function getErrorText(
	error: unknown,
	options: RedactionOptions,
): string {
	return JSON.stringify(errorReport(error, options), null, 2);
}

export async function promptCopyError(error: unknown): Promise<void> {
	const copyOptions = await confirmCopyError(error);
	if ("abort" in copyOptions) return;
	await writeToClipboard(getErrorText(error, { redact: copyOptions.redact }));
}

async function writeToClipboard(text: string): Promise<void> {
	try {
		await clipboard.writeText(text);
		toast.success("Copied to clipboard");
	} catch (error) {
		console.error(error);
	}
}

export function showErrorToast({
	label = "An error occurred",
	error,
	onRetry,
}: {
	label?: string;
	error: unknown;
	onRetry?: () => void;
}) {
	reportPresentedError(error, "error_toast");
	if (
		error instanceof ApiError &&
		(error.kind === "RequestBlocked" || error.kind === "RequestCooldown") &&
		!isSafeRead(error.request.method, error.request.path)
	) {
		toast.error(label, {
			description: "The action was not sent and was not retried.",
			action: {
				label: "Copy details",
				onClick: () => void promptCopyError(error).catch(() => {}),
			},
		});
		return;
	}
	if (onRetry && error instanceof ApiError && error.retryable) {
		toast.error(label, {
			action: {
				label: "Retry",
				onClick: onRetry,
			},
			cancel: {
				label: "Copy details",
				onClick: () => void promptCopyError(error).catch(() => {}),
			},
		});
		return;
	}
	toast.error(label, {
		action: {
			label: "Copy details",
			onClick: () => void promptCopyError(error).catch(() => {}),
		},
	});
}

function isSafeRead(method: string, path: string): boolean {
	const route = path.split("?", 1)[0];
	return (
		method === "GET" ||
		method === "HEAD" ||
		(method === "POST" && (route === "/v4/inbox" || route === "/v3/profiles"))
	);
}
