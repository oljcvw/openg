<script lang="ts">
	import { goto, replaceState } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount } from "svelte";

	import { callMethod } from "$lib/api";
	import {
		getAccountSessionSnapshot,
		subscribeAccountGeneration,
	} from "$lib/api/account-caches";
	import { syncApiRuntimeSettings } from "$lib/api/runtime-settings";
	import {
		getDeveloperSettingsSnapshot,
		hydratePreferences,
	} from "$lib/app-data/preferences.svelte";
	import CommandCenter from "$lib/components/command-center/CommandCenter.svelte";
	import { reconcilePendingProfileLocation } from "$lib/location/profile-location";
	import {
		type CurrentNavigationRuntime,
		installCurrentNavigationCoordinator,
		setSemanticRouteBackHandler,
	} from "$lib/navigation/app-navigation";
	import VideoCallHost from "$lib/video-call/components/VideoCallHost.svelte";

	let { children }: import("./$types").LayoutProps = $props();
	let accountGeneration = $state(getAccountSessionSnapshot().generation);
	let navigationRuntime = $state<CurrentNavigationRuntime | null>(null);

	$effect(() => {
		const generation = accountGeneration;
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: generation,
			effects: {
				goto: (route, options) => goto(route, options),
				pop: () => history.back(),
				replaceState: (route, state) => replaceState(route, state),
			},
		});
		navigationRuntime = runtime;
		const releaseSemanticBack = setSemanticRouteBackHandler(() =>
			runtime.coordinator.handleSemanticBack(page.url.pathname, page.state),
		);

		return () => {
			releaseSemanticBack();
			runtime.release();
			if (navigationRuntime === runtime) navigationRuntime = null;
		};
	});

	$effect(() => {
		const runtime = navigationRuntime;
		const route = page.url.href;
		const state = page.state;
		if (!runtime) return;
		void runtime.synchronize(route, state).catch(() => {
			// A superseded account coordinator cannot write navigation state.
		});
	});

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
		const releaseAccountGeneration = subscribeAccountGeneration(
			(generation) => {
				accountGeneration = generation;
			},
		);
		void syncHydratedPreferences().catch((error) => {
			console.error("Failed to sync hydrated preferences", error);
		});
		void reconcilePendingProfileLocation().catch((error) => {
			console.error("Failed to reconcile pending profile location", error);
		});
		return releaseAccountGeneration;
	});
</script>

{@render children()}
<CommandCenter />
<VideoCallHost />
