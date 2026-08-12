import { invoke, isTauri } from "@tauri-apps/api/core";

import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

const consoleMethods: ConsoleMethod[] = [
	"debug",
	"error",
	"info",
	"log",
	"warn",
];
const originalConsole = new Map<ConsoleMethod, typeof console.log>();

for (const method of consoleMethods)
	originalConsole.set(method, console[method].bind(console));

function setFrontendLogging(enabled: boolean): void {
	if (!isTauri()) return;
	for (const method of consoleMethods) {
		console[method] = enabled
			? (originalConsole.get(method) as typeof console.log)
			: () => {};
	}
}

export async function applyLogcatSetting(
	enabled = getDeveloperSettingsSnapshot().logErrorsToLogcat,
): Promise<void> {
	setFrontendLogging(enabled);
	if (!isTauri()) return;
	await invoke("set_logcat_enabled", { enabled });
}

export function initializeLogcatSetting(): void {
	setFrontendLogging(false);
}
