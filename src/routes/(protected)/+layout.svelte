<script lang="ts">
	import { afterNavigate, goto, replaceState } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount, untrack } from "svelte";

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
	let navigationRuntime: CurrentNavigationRuntime | null = null;
	let routerReady = false;

	function synchronizeNavigationRuntime(
		runtime: CurrentNavigationRuntime,
		route: string,
		state: unknown,
	): void {
		void runtime.synchronize(route, state).catch(() => {
			// A superseded account coordinator cannot write navigation state.
		});
	}

	afterNavigate(() => {
		routerReady = true;
		const runtime = navigationRuntime;
		if (runtime)
			synchronizeNavigationRuntime(runtime, page.url.href, page.state);
	});

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
		if (routerReady) {
			const current = untrack(() => ({
				route: page.url.href,
				state: page.state,
			}));
			synchronizeNavigationRuntime(runtime, current.route, current.state);
		}
		const releaseSemanticBack = setSemanticRouteBackHandler(() =>
			runtime.coordinator.handleSemanticBack(page.url.pathname, page.state),
		);

		return () => {
			releaseSemanticBack();
			runtime.release();
			if (navigationRuntime === runtime) navigationRuntime = null;
		};
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
