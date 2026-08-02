<script lang="ts">
	import { onMount } from "svelte";

	import { callMethod } from "$lib/api";
	import { syncApiRuntimeSettings } from "$lib/api/runtime-settings";
	import {
		getDeveloperSettingsSnapshot,
		hydratePreferences,
	} from "$lib/app-data/preferences.svelte";
	import CommandCenter from "$lib/components/command-center/CommandCenter.svelte";
	import { reconcilePendingProfileLocation } from "$lib/location/profile-location";

	let {
		children,
	}: {
		children: import("svelte").Snippet;
	} = $props();

	async function syncHydratedPreferences(): Promise<void> {
		await hydratePreferences();
		await Promise.all([
			syncApiRuntimeSettings(),
			callMethod("notification_sync", {
				intervalMinutes:
					getDeveloperSettingsSnapshot().notificationPollIntervalMinutes,
			}),
		]);
	}

	onMount(() => {
		void syncHydratedPreferences().catch((error) => {
			console.error("Failed to sync hydrated preferences", error);
		});
		void reconcilePendingProfileLocation().catch((error) => {
			console.error("Failed to reconcile pending profile location", error);
		});
	});
</script>

{@render children()}
<CommandCenter />
