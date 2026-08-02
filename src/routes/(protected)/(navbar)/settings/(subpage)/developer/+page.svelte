<script lang="ts">
	import { toast } from "svelte-sonner";

	import { callMethod } from "$lib/api";
	import { showErrorToast } from "$lib/api/error";
	import { syncApiRuntimeSettings } from "$lib/api/runtime-settings";
	import { resetDeveloperSettings } from "$lib/app-data/preferences.svelte";
	import { trimShortVideoCache } from "$lib/app-data/short-video-cache";
	import { Button } from "$lib/components/ui/button";
	import DeveloperBooleanSetting from "./DeveloperBooleanSetting.svelte";
	import DeveloperNumberSetting from "./DeveloperNumberSetting.svelte";
	import DeveloperQualitySetting from "./DeveloperQualitySetting.svelte";

	let resetting = $state(false);

	async function syncNotificationSchedule(
		intervalMinutes: number,
	): Promise<void> {
		await callMethod("notification_sync", { intervalMinutes });
	}

	async function applyApiRuntimeSettings(): Promise<void> {
		await syncApiRuntimeSettings();
	}

	async function applyShortVideoCacheLimit(): Promise<void> {
		await trimShortVideoCache();
	}

	async function reset(): Promise<void> {
		resetting = true;
		try {
			await resetDeveloperSettings();
			toast.success("Developer settings reset");
			window.location.reload();
		} catch (error) {
			showErrorToast({ label: "Failed to reset Developer Settings", error });
			resetting = false;
		}
	}
</script>

<p class="px-4 text-sm text-muted-foreground">
	Advanced controls for diagnosing performance and API behavior. Defaults are
	recommended for normal use.
</p>

<h2>Browse</h2>
<DeveloperNumberSetting
	setting="profileResolutionBatchSize"
	title="Profile resolution batch size"
	description="Maximum number of visible profile summaries resolved in one API request."
	min={1}
	max={30}
	unit="profiles"
/>
<DeveloperNumberSetting
	setting="profileResolutionWindowMs"
	title="Profile batch collection window"
	description="Time allowed to collect newly visible profiles before resolving them together."
	min={0}
	max={1000}
	unit="milliseconds"
/>

<h2>Chat media</h2>
<DeveloperNumberSetting
	setting="shortVideoCacheMb"
	title="Short-video cache"
	description="Maximum encrypted app-private storage used for sent and received short videos."
	min={10}
	max={500}
	unit="MB"
	onsaved={applyShortVideoCacheLimit}
/>
<DeveloperBooleanSetting
	setting="shortVideoLooping"
	title="Loop short videos"
	description="Request looping playback for newly recorded short videos."
/>
<DeveloperNumberSetting
	setting="albumPreloadConcurrency"
	title="Album preload concurrency"
	description="Maximum album photos and videos inspected at the same time before opening the viewer."
	min={1}
	max={8}
	unit="media items"
/>

<h2>Video calls</h2>
<DeveloperQualitySetting />

<h2>Diagnostics</h2>
<DeveloperBooleanSetting
	setting="mediaDiagnostics"
	title="Media diagnostics"
	description="Write detailed capture, upload, playback, and call lifecycle events to logcat without media contents or credentials."
/>

<h2>Search and sync</h2>
<DeveloperNumberSetting
	setting="placeSearchCacheEntries"
	title="Place search cache size"
	description="Maximum recent place searches retained in memory while the location picker remains open."
	min={1}
	max={100}
	unit="searches"
/>
<DeveloperNumberSetting
	setting="reconcileThrottleMs"
	title="Realtime sync throttle"
	description="Minimum spacing between coalesced foreground and realtime reconciliation passes."
	min={2000}
	max={30000}
	step={250}
	unit="milliseconds"
/>

<h2>Notifications</h2>
<DeveloperNumberSetting
	setting="notificationPollIntervalMinutes"
	title="Background polling interval"
	description="Requested spacing between Android background notification checks. Android may delay checks further."
	min={15}
	max={1440}
	unit="minutes"
	onsaved={syncNotificationSchedule}
/>

<h2>API</h2>
<DeveloperNumberSetting
	setting="apiRequestTimeoutMs"
	title="API request timeout"
	description="Maximum time the app waits for a backend API request before reporting a timeout."
	min={5000}
	max={120000}
	step={1000}
	unit="milliseconds"
/>

<h2>API recovery</h2>
<DeveloperNumberSetting
	setting="apiCircuitWindowSize"
	title="Circuit history window"
	description="Number of recent API outcomes retained when evaluating service instability."
	min={20}
	max={100}
	unit="outcomes"
	onsaved={applyApiRuntimeSettings}
/>
<DeveloperNumberSetting
	setting="apiCircuitMinimumSamples"
	title="Circuit minimum samples"
	description="Minimum recent outcomes required before the API circuit can pause requests."
	min={5}
	max={20}
	unit="outcomes"
	onsaved={applyApiRuntimeSettings}
/>
<DeveloperNumberSetting
	setting="apiCircuitFailurePercent"
	title="Circuit failure threshold"
	description="Failure percentage that pauses requests after the minimum sample count is reached."
	min={25}
	max={50}
	unit="percent"
	onsaved={applyApiRuntimeSettings}
/>
<DeveloperNumberSetting
	setting="apiCircuitOpenMs"
	title="Circuit pause duration"
	description="How long ordinary requests pause after the circuit opens."
	min={30000}
	max={300000}
	step={5000}
	unit="milliseconds"
	onsaved={applyApiRuntimeSettings}
/>
<DeveloperNumberSetting
	setting="apiProtectionCooldownMs"
	title="Protection cooldown"
	description="How long optional profile enrichment pauses after upstream protection blocks it."
	min={30000}
	max={300000}
	step={5000}
	unit="milliseconds"
	onsaved={applyApiRuntimeSettings}
/>

<Button variant="outline" disabled={resetting} onclick={() => void reset()}>
	Reset developer settings
</Button>

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply mt-2 truncate ps-4 text-xl font-semibold tracking-tight;
	}
</style>
