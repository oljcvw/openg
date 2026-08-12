<script lang="ts">
	import MapPinIcon from "phosphor-svelte/lib/MapPinIcon";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPendingProfileLocationSnapshot,
		getReportedProfileLocationSnapshot,
	} from "$lib/app-data/preferences.svelte";
	import LocationMap from "$lib/components/location/LocationMap.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { getMessageComposerContext } from "../message-composer-context.svelte";

	let { active, onClose }: { active: boolean; onClose: () => void } = $props();
	const composer = getMessageComposerContext();
	const reportedLocation = $derived(
		active ? getReportedProfileLocationSnapshot() : null,
	);
	const pendingLocation = $derived(
		active ? getPendingProfileLocationSnapshot() : null,
	);
	let sending = $state(false);
	let loadTiles = $state(false);

	$effect(() => {
		if (!active) {
			loadTiles = false;
		}
	});

	async function share() {
		if (
			reportedLocation === null ||
			pendingLocation !== null ||
			sending ||
			composer().disabled
		)
			return;
		sending = true;
		try {
			await composer().sendMessage({
				type: "Location",
				body: { lat: reportedLocation.lat, lon: reportedLocation.lon },
			});
			onClose();
		} catch (error) {
			showErrorToast({ label: "Failed to share profile location", error });
		} finally {
			sending = false;
		}
	}
</script>

<div class="flex flex-col gap-4 pb-2">
	{#if pendingLocation !== null}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><MapPinIcon weight="fill" /></Empty.Media>
				<Empty.Title>Updating profile location</Empty.Title>
				<Empty.Description
					>Location sharing becomes available after the update finishes.</Empty.Description
				>
			</Empty.Header>
		</Empty.Root>
	{:else if reportedLocation === null}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><MapPinIcon weight="fill" /></Empty.Media>
				<Empty.Title>Set your profile location first</Empty.Title>
				<Empty.Description
					>Use the location control in Browse to set or refresh the profile
					location shared here.</Empty.Description
				>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<div class="flex flex-col gap-3">
			<div class="relative h-44 overflow-clip rounded-xl">
				<LocationMap point={reportedLocation} {loadTiles} />
				{#if !loadTiles}
					<button
						type="button"
						class="absolute inset-0 text-sm font-medium"
						onclick={() => (loadTiles = true)}>Load map preview</button
					>
				{/if}
				{#if reportedLocation.source === "manual"}
					<span
						class="absolute top-2 left-2 rounded-full bg-background/85 px-2 py-1 text-xs font-medium backdrop-blur"
						>Custom profile location</span
					>
				{/if}
			</div>
			<p class="text-sm text-muted-foreground">
				Shares your reported profile location. Your current Browse area is not
				used.
			</p>
			<Button
				size="lg"
				disabled={sending || composer().disabled}
				onclick={share}>Share profile location</Button
			>
		</div>
	{/if}
</div>
