import { callMethod } from "$lib/api";
import {
	type DeveloperSettings,
	getDeveloperSettingsSnapshot,
} from "$lib/app-data/preferences.svelte";

type RuntimeSettings = Pick<
	DeveloperSettings,
	| "apiCircuitFailurePercent"
	| "apiCircuitMinimumSamples"
	| "apiCircuitOpenMs"
	| "apiCircuitWindowSize"
	| "apiProtectionCooldownMs"
>;

export async function syncApiRuntimeSettings(
	settings: RuntimeSettings = getDeveloperSettingsSnapshot(),
): Promise<void> {
	await callMethod("api_runtime_configure", settings);
}
