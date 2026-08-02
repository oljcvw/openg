import * as clipboard from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "svelte-sonner";

import { ApiError } from "$lib/api/api-error";
import {
	getPreferences,
	setPreferences,
} from "$lib/app-data/preferences.svelte";
import { reportPresentedError } from "$lib/platform/client-diagnostics";

export function getErrorText(error: unknown): string {
	if (error instanceof ApiError) {
		return error.copyableText();
	}
	if (error instanceof Error) {
		return JSON.stringify(
			{ error: error.message, stack: error.stack },
			null,
			2,
		);
	}
	return String(error);
}

export function copyError(error: unknown) {
	const errorText = getErrorText(error);
	clipboard
		.writeText(errorText)
		.then(async () => {
			toast.success("Copied to clipboard");
			if (await getPreferences().then((p) => p.warnBeforeCopyingErrorDetails)) {
				toast.warning("Be mindful of what you share on the internet!", {
					description:
						"Error details may contain your personal and sensitive data. Redact before sharing them with others.",
					duration: 7000,
				});
				void setPreferences({ warnBeforeCopyingErrorDetails: false });
			}
		})
		.catch((e) => console.error(e));
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
				onClick: () => copyError(error),
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
				onClick: () => copyError(error),
			},
		});
		return;
	}
	toast.error(label, {
		action: {
			label: "Copy details",
			onClick: () => copyError(error),
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
