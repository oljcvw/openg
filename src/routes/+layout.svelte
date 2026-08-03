<script lang="ts">
	import { isTauri } from "@tauri-apps/api/core";
	import { platform } from "@tauri-apps/plugin-os";
	import "@fontsource-variable/ibm-plex-sans/wght.css";
	import "@fontsource-variable/ibm-plex-sans/wght-italic.css";

	import "../layout.css";
	import { page } from "$app/state";
	import { IconContext } from "phosphor-svelte";
	import { onMount } from "svelte";
	import { Toaster } from "svelte-sonner";

	import { registerApiHealthListener } from "$lib/api/api-health-state.svelte";
	import {
		getContrastModeSnapshot,
		getStayAwakeSnapshot,
		hydratePreferences,
	} from "$lib/app-data/preferences.svelte";
	import {
		applyAndroidInsets,
		applyBackGestureHandler,
		registerAndroidBackButtonListener,
	} from "$lib/platform/android-native-bridge";
	import { blockZoom } from "$lib/platform/block-zoom";
	import { registerGlobalErrorReporting } from "$lib/platform/client-diagnostics";
	import { applyLogcatSetting } from "$lib/platform/logcat-settings";
	import { registerMediaOriginLogging } from "$lib/platform/media-origin-logging";
	import {
		applyStayAwake,
		registerStayAwakeVisibilityListener,
	} from "$lib/platform/stay-awake";
	import { applyContrastMode } from "$lib/theme/contrast";

	$effect(() => {
		applyContrastMode(getContrastModeSnapshot());
	});

	$effect(() => {
		const stayAwake = getStayAwakeSnapshot();
		void applyStayAwake(stayAwake).catch((error) => {
			console.error("Failed to apply Stay Awake preference", error);
		});
	});

	onMount(() => {
		if (env.PUBLIC_TEST_INSETS) {
			window.__AndroidInsets = {
				top() {
					return 64;
				},
				bottom() {
					return 64;
				},
				left() {
					return 0;
				},
				right() {
					return 0;
				},
			};
		}
		applyAndroidInsets();
		applyBackGestureHandler();
		const releaseZoomBlock = blockZoom();
		if (isTauri() && platform() === "android") {
			void registerAndroidBackButtonListener().catch((error) => {
				console.error("Failed to register back button listener", error);
			});
		}
		void hydratePreferences()
			.then(() => applyLogcatSetting())
			.catch((error) => {
				console.error("Failed to hydrate preferences", error);
			});
		const releaseStayAwake = registerStayAwakeVisibilityListener();
		const releaseApiHealth = registerApiHealthListener();
		const releaseErrorReporting = registerGlobalErrorReporting();
		const releaseMediaOriginLogging = isTauri()
			? registerMediaOriginLogging()
			: () => {};
		return () => {
			releaseMediaOriginLogging();
			releaseErrorReporting();
			releaseApiHealth();
			releaseStayAwake();
			releaseZoomBlock();
		};
	});

	import { env } from "$env/dynamic/public";

	import favicon from "$lib/assets/favicon.png";
	import AccountStatusAlert from "$lib/components/feedback/AccountStatusAlert.svelte";
	import ApiMitigationBanner from "$lib/components/feedback/ApiMitigationBanner.svelte";
	import SessionErrorAlert from "$lib/components/feedback/SessionErrorAlert.svelte";

	let {
		children,
	}: {
		children?: import("svelte").Snippet;
	} = $props();

	const hasBottomNavBar = $derived(
		page.route.id?.startsWith("/(protected)/(navbar)") ?? false,
	);
	const toastOffset = $derived({
		top: "calc(var(--safe-area-top) + 0.5rem)",
		bottom: hasBottomNavBar
			? "calc(var(--content-pb) + 0.5rem)"
			: "calc(var(--safe-area-bottom) + 0.5rem)",
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>
<div
	class={[
		"fixed inset-x-0 top-0 z-150000",
		{
			"bg-background/50": !env.PUBLIC_TEST_INSETS,
			"bg-red-900": env.PUBLIC_TEST_INSETS,
		},
	]}
	style="height: var(--safe-area-top)"
></div>
<div
	class={[
		"fixed inset-x-0 bottom-0 z-150000",
		{
			"bg-background/50": !env.PUBLIC_TEST_INSETS,
			"bg-red-900": env.PUBLIC_TEST_INSETS,
		},
	]}
	style="height: var(--safe-area-bottom)"
></div>
<Toaster
	position="bottom-center"
	offset={toastOffset}
	mobileOffset={toastOffset}
	toastOptions={{
		class: "toast",
	}}
	expand
/>
<ApiMitigationBanner />
<IconContext values={{}}>
	{@render children?.()}
</IconContext>
<SessionErrorAlert />
<AccountStatusAlert />
