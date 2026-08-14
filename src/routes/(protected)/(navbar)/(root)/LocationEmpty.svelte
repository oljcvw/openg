<script lang="ts">
	import { platform } from "@tauri-apps/plugin-os";
	import GpsFixIcon from "phosphor-svelte/lib/GpsFixIcon";
	import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
	import NavigationArrowIcon from "phosphor-svelte/lib/NavigationArrowIcon";

	import { showErrorToast } from "$lib/api/error";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { browseThisArea } from "$lib/location/profile-location";
	import { requestProfileLocation } from "$lib/location/profile-location-wifi-warning";
	import type { LocationPoint } from "$lib/model/location";

	let geoMapPickerOpen = $state(false);

	const geoApiSupported = $derived(["android", "ios"].includes(platform()));
	let disabled = $state(false);

	async function handleDetectLocation() {
		disabled = true;
		try {
			await requestProfileLocation({ kind: "device" });
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to use current device location",
				error,
			});
		} finally {
			disabled = false;
		}
	}

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
</script>

<Empty.Root class="max-md:p-6">
	<Empty.Header>
		<Empty.Media variant="icon">
			<NavigationArrowIcon weight="fill" color="var(--primary)" />
		</Empty.Media>
		<Empty.Title>Choose location</Empty.Title>
		<Empty.Description>
			Pick a location on the map or select from the list to find nearby
			profiles.
		</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<div class="flex flex-wrap justify-center gap-2">
			{#if geoApiSupported}
				<Button variant="default" onclick={handleDetectLocation} {disabled}>
					<GpsFixIcon color="currentColor" weight="fill" />
					Use current location
				</Button>
			{/if}
			<Button
				variant={geoApiSupported ? "outline" : "default"}
				onclick={() => (geoMapPickerOpen = true)}
			>
				<MagnifyingGlassIcon color="currentColor" weight="fill" />
				Pick manually
			</Button>
		</div>
	</Empty.Content>
	<!-- <Button variant="link" class="text-muted-foreground" size="sm">
		<a href="#/">
			Learn More <ArrowUpRightIcon class="inline" />
		</a>
	</Button> -->
</Empty.Root>
{#if geoMapPickerOpen}
	{#await import("$lib/components/location-chooser/LocationChooser.svelte") then { default: LocationChooser }}
		<LocationChooser
			{onBrowse}
			{onSetProfile}
			onUseDeviceLocation={geoApiSupported ? onUseDeviceLocation : undefined}
			bind:open={geoMapPickerOpen}
		/>
	{/await}
{/if}
