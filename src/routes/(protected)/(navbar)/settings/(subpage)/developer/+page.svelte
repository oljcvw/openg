<script lang="ts">
	import { toast } from "svelte-sonner";

	import { callMethod } from "$lib/api";
	import { showErrorToast } from "$lib/api/error";
	import { syncApiRuntimeSettings } from "$lib/api/runtime-settings";
	import { trimDirectMediaCache } from "$lib/app-data/direct-media-cache";
	import {
		getDeveloperSettingsSnapshot,
		resetDeveloperSettings,
	} from "$lib/app-data/preferences.svelte";
	import { trimShortVideoCache } from "$lib/app-data/short-video-cache";
	import { Button } from "$lib/components/ui/button";
	import { applyLogcatSetting } from "$lib/platform/logcat-settings";
	import DeveloperAgeScaleSetting from "./DeveloperAgeScaleSetting.svelte";
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

	async function applyDirectMediaCacheLimit(): Promise<void> {
		const maximumBytes =
			getDeveloperSettingsSnapshot().directMediaCacheMb * 1024 * 1024;
		await Promise.all([
			trimDirectMediaCache(maximumBytes),
			trimShortVideoCache(),
		]);
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
<DeveloperAgeScaleSetting />
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
	setting="directMediaCacheMb"
	title="Direct-media cache"
	description="Maximum encrypted app-private storage used for received chat images and videos."
	min={10}
	max={500}
	unit="MB"
	onsaved={applyDirectMediaCacheLimit}
/>
<DeveloperNumberSetting
	setting="directMediaCacheConcurrency"
	title="Direct-media cache concurrency"
	description="Maximum visible received media files cached at the same time."
	min={1}
	max={4}
	unit="media items"
/>
<DeveloperNumberSetting
	setting="legacyShortVideoFetchTimeoutMs"
	title="Legacy video fetch timeout"
	description="Maximum time spent downloading an older received short video for encrypted cache promotion."
	min={5000}
	max={120000}
	step={5000}
	unit="milliseconds"
/>
<DeveloperNumberSetting
	setting="legacyShortVideoFetchMaxMb"
	title="Legacy video fetch limit"
	description="Maximum size of one older received short video downloaded for encrypted cache promotion."
	min={10}
	max={100}
	step={5}
	unit="MB"
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
<DeveloperNumberSetting
	setting="albumPreloadTimeoutMs"
	title="Album preload timeout"
	description="Maximum time spent preparing album media before the viewer opens with placeholders."
	min={5000}
	max={120000}
	step={5000}
	unit="milliseconds"
/>
<DeveloperNumberSetting
	setting="sharedAlbumRefreshSeconds"
	title="Shared-album refresh interval"
	description="Foreground refresh interval while the received-albums drawer is open."
	min={30}
	max={600}
	step={30}
	unit="seconds"
/>
<DeveloperNumberSetting
	setting="albumCacheRequestIntervalMs"
	title="Album cache request interval"
	description="Minimum spacing between background album-detail requests while building the retained cache."
	min={500}
	max={30000}
	step={500}
	unit="milliseconds"
/>
<DeveloperNumberSetting
	setting="albumCacheMediaConcurrency"
	title="Album cache media concurrency"
	description="Maximum album media downloads running together inside one background cache build."
	min={1}
	max={4}
	unit="media items"
/>
<DeveloperNumberSetting
	setting="albumCacheValidationMinutes"
	title="Album cache validation age"
	description="How old an active cached album may be before rediscovery queues an access refresh."
	min={5}
	max={1440}
	step={5}
	unit="minutes"
/>
<DeveloperNumberSetting
	setting="albumCacheCdnRetryLimit"
	title="Album cache CDN retries"
	description="Maximum retries for transient signed-media download failures during one cache build."
	min={0}
	max={5}
	unit="retries"
/>

<h2>Video calls</h2>
<DeveloperQualitySetting />

<h2>Diagnostics</h2>
<DeveloperBooleanSetting
	setting="logErrorsToLogcat"
	title="Log errors to logcat"
	description="Allow Open Grind diagnostics and errors to be written to Android logcat. Disabled by default to reduce system log clutter."
	onsaved={applyLogcatSetting}
/>
<DeveloperBooleanSetting
	setting="mediaDiagnostics"
	title="Media diagnostics"
	description="Write detailed capture, upload, playback, and call lifecycle events to logcat without media contents or credentials."
/>

<h2>Search and sync</h2>
<DeveloperNumberSetting
	setting="profileCacheMaxEntries"
	title="Profile cache size"
	description="Maximum fresh profile records retained in memory for the active account."
	min={100}
	max={2000}
	unit="profiles"
/>
<DeveloperNumberSetting
	setting="conversationSearchConcurrency"
	title="Conversation search concurrency"
	description="Maximum cached conversations read and indexed at the same time."
	min={1}
	max={6}
	unit="conversations"
/>
<DeveloperNumberSetting
	setting="albumShareDiscoveryConcurrency"
	title="Album-share discovery concurrency"
	description="Maximum album-share lookups running together for the active recipient."
	min={1}
	max={8}
	unit="albums"
/>
<DeveloperNumberSetting
	setting="conversationSearchDebounceMs"
	title="Conversation search debounce"
	description="Delay before searching cached message text after the inbox search query changes."
	min={50}
	max={2000}
	step={50}
	unit="milliseconds"
/>
<DeveloperNumberSetting
	setting="cacheManifestTouchIntervalMinutes"
	title="Cache manifest touch interval"
	description="Minimum interval before a cache hit persists another whole-manifest access-time update. Higher values reduce storage writes but make eviction recency coarser after restart."
	min={1}
	max={1440}
	unit="minutes"
/>
<DeveloperNumberSetting
	setting="messageDuplicateReconcileWindowMs"
	title="Message duplicate reconciliation window"
	description="Time window used only to reconcile older cached sends that lack an exact delivery reference."
	min={1000}
	max={30000}
	step={1000}
	unit="milliseconds"
/>
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
