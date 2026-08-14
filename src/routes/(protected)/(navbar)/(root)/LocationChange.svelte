<script lang="ts">
	import { platform } from "@tauri-apps/plugin-os";
	import { MapPinIcon, SpinnerGapIcon } from "phosphor-svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getGeohashSnapshot,
		getLocationActivitySnapshot,
	} from "$lib/app-data/preferences.svelte";
	import { Button } from "$lib/components/ui/button";
	import { browseThisArea } from "$lib/location/profile-location";
	import { requestProfileLocation } from "$lib/location/profile-location-wifi-warning";
	import { decodeGeohash } from "$lib/model/geohash";
	import type LocationChooser from "$lib/components/location-chooser/LocationChooser.svelte";
	import type { LocationPoint } from "$lib/model/location";

	let {
		class: className,
	}: {
		class?: import("svelte/elements").ClassValue;
	} = $props();

	let pinPos: { lat: number; lon: number; zoom: number } | undefined = $state();
	let geoMapPickerOpen = $state(false);

	const deviceLocationAvailable = ["android", "ios"].includes(platform());
	const activity = $derived(getLocationActivitySnapshot());
	const activityLabel = $derived.by(() => {
		switch (activity) {
			case "device":
				return "Using device location";
			case "browse":
				return "Browsing another area";
			case "profile":
				return "Custom profile location active";
			case "profile-and-browse":
				return "Custom profile location active; browsing another area";
			case "pending":
				return "Updating profile location";
		}
	});

	async function runLocationAction(label: string, action: () => Promise<void>) {
		try {
			await action();
		} catch (error) {
			console.error(error);
			showErrorToast({
				label,
				error,
			});
			throw error;
		}
	}

	const onBrowse = (point: LocationPoint) =>
		runLocationAction("Failed to change Browse location", () =>
			browseThisArea(point),
		);
	const onSetProfile = (point: LocationPoint) =>
		runLocationAction("Failed to set profile location", () =>
			requestProfileLocation({ kind: "manual", point }).then(() => undefined),
		);
	const onUseDeviceLocation = () =>
		runLocationAction("Failed to use current device location", () =>
			requestProfileLocation({ kind: "device" }).then(() => undefined),
		);

	function openPicker() {
		const geohash = getGeohashSnapshot();
		pinPos = geohash
			? {
					...decodeGeohash(geohash),
					zoom: 17,
				}
			: undefined;
		geoMapPickerOpen = true;
	}

	let locationChooser: LocationChooser | null = $state(null);
	$effect(() => {
		if (geoMapPickerOpen && pinPos && locationChooser)
			locationChooser.centerAt(pinPos);
	});
</script>

<Button
	variant="secondary"
	aria-label={activityLabel}
	title={activityLabel}
	disabled={activity === "pending"}
	class={[
		"relative w-11 overflow-clip transition-none *:absolute *:top-1/2 *:left-1/2 *:flex *:-translate-1/2 *:items-center *:justify-center *:gap-1.5",
		{
			"bg-sky-500/20 text-sky-400 hover:bg-sky-500/30": activity === "browse",
			"bg-primary text-primary-foreground hover:bg-primary/90":
				activity === "profile" || activity === "profile-and-browse",
		},
		className,
	]}
	onclick={openPicker}
>
	{#if activity === "pending"}
		<SpinnerGapIcon weight="bold" class="animate-spin" />
	{:else}
		<MapPinIcon weight="fill" />
		{#if activity === "profile-and-browse"}
			<span
				class="absolute! top-1! right-1! left-auto! size-2 translate-none! rounded-full bg-sky-400 ring-1 ring-background"
			></span>
		{/if}
	{/if}
</Button>
{#if geoMapPickerOpen}
	{#await import("$lib/components/location-chooser/LocationChooser.svelte") then { default: LocationChooser }}
		<LocationChooser
			{onBrowse}
			{onSetProfile}
			onUseDeviceLocation={deviceLocationAvailable
				? onUseDeviceLocation
				: undefined}
			bind:open={geoMapPickerOpen}
			bind:this={locationChooser}
			bind:pinPos
		/>
	{/await}
{/if}
