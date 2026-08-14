<script lang="ts">
	import { platform } from "@tauri-apps/plugin-os";
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
		getManualLocationActiveSnapshot,
		getPendingProfileLocationSnapshot,
		hydratePreferences,
	} from "$lib/app-data/preferences.svelte";
	import CommandCenter from "$lib/components/command-center/CommandCenter.svelte";
	import ProfileLocationWifiWarning from "$lib/components/location/ProfileLocationWifiWarning.svelte";
	import {
		invalidateProfileLocationMutations,
		profileLocationCoordinator,
	} from "$lib/location/profile-location";
	import {
		closeProfileLocationWifiWarning,
		showProfileLocationWifiWarning,
	} from "$lib/location/profile-location-wifi-warning";
	import {
		type CurrentNavigationRuntime,
		installCurrentNavigationCoordinator,
		setSemanticRouteBackHandler,
	} from "$lib/navigation/app-navigation";
	import { installIosNotificationRouteListener } from "$lib/notifications/native-listener";
	import {
		isUnsafeWifiSnapshot,
		listenForWifiSafetyChanges,
		type WifiSafetySnapshot,
	} from "$lib/platform/wifi-location-safety";
	import VideoCallHost from "$lib/video-call/components/VideoCallHost.svelte";

	let { children }: import("./$types").LayoutProps = $props();
	let accountGeneration = $state(getAccountSessionSnapshot().generation);
	let navigationRuntime: CurrentNavigationRuntime | null = null;
	let routerReady = false;
	let protectedReady = $state(false);
	let bootstrapError = $state<unknown>(null);
	let safetyInitialization: Promise<void> | null = null;

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

	function mobilePlatform(): "android" | "ios" {
		return platform() === "ios" ? "ios" : "android";
	}

	function locationStateRequiresSafety(): boolean {
		return (
			getManualLocationActiveSnapshot() ||
			getPendingProfileLocationSnapshot() !== null
		);
	}

	async function initializeProtectedSafety(): Promise<void> {
		if (safetyInitialization) return safetyInitialization;
		safetyInitialization = (async () => {
			protectedReady = false;
			bootstrapError = null;
			await hydratePreferences();
			const outcome = await profileLocationCoordinator.bootstrap();
			if (outcome.kind === "blockedByWifi") {
				showProfileLocationWifiWarning(outcome.platform, null);
				return;
			}
			await syncHydratedPreferences();
			closeProfileLocationWifiWarning();
			protectedReady = true;
		})()
			.catch((error) => {
				bootstrapError = error;
				console.error("Protected location-safety bootstrap failed", error);
			})
			.finally(() => {
				safetyInitialization = null;
			});
		return safetyInitialization;
	}

	function handleWifiSafetyChange(snapshot: WifiSafetySnapshot): void {
		if (isUnsafeWifiSnapshot(snapshot) && locationStateRequiresSafety()) {
			protectedReady = false;
			showProfileLocationWifiWarning(mobilePlatform(), null);
			return;
		}
		if (!isUnsafeWifiSnapshot(snapshot) && !protectedReady) {
			void initializeProtectedSafety();
		}
	}

	onMount(() => {
		const releaseNotificationListener = installIosNotificationRouteListener(
			(route) => goto(route),
		);
		const releaseAccountGeneration = subscribeAccountGeneration(
			(generation) => {
				if (generation !== accountGeneration) {
					invalidateProfileLocationMutations();
					protectedReady = false;
					queueMicrotask(() => void initializeProtectedSafety());
				}
				accountGeneration = generation;
			},
		);
		const wifiSafetyListener = listenForWifiSafetyChanges(
			handleWifiSafetyChange,
		).catch((error) => {
			bootstrapError = error;
			console.error("Failed to register Wi-Fi safety listener", error);
			return null;
		});
		void initializeProtectedSafety();
		return () => {
			releaseNotificationListener();
			releaseAccountGeneration();
			void wifiSafetyListener.then((release) => release?.());
		};
	});
</script>

{#if protectedReady}
	{@render children()}
	<CommandCenter />
	<VideoCallHost />
{:else}
	<div class="flex min-h-svh items-center justify-center p-6 text-center">
		<div class="max-w-md space-y-2">
			<h1 class="text-lg font-semibold">Location safety check</h1>
			<p class="text-sm text-muted-foreground">
				{bootstrapError
					? "Open Grind could not establish a safe network state. Grindr traffic remains paused."
					: "Open Grind is waiting for a known non-Wi-Fi network before loading your account."}
			</p>
		</div>
	</div>
{/if}
<ProfileLocationWifiWarning />
