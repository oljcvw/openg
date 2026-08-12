<script lang="ts">
	import NavigationArrowIcon from "phosphor-svelte/lib/NavigationArrowIcon";

	import LocationMap from "$lib/components/location/LocationMap.svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import Link from "$lib/components/ui/link/Link.svelte";
	import { openStreetMapUrl } from "$lib/location/map";
	import type { LocationMessage } from "$lib/model/messaging/messages";

	let { message }: { message: LocationMessage["body"] } = $props();
	const href = $derived(openStreetMapUrl(message));
	let loadTiles = $state(false);
</script>

<div
	class="flex w-72 max-w-[min(72vw,18rem)] flex-col gap-2 p-2"
	aria-label="Shared location"
>
	<div class="relative h-40">
		<LocationMap point={message} {loadTiles} />
		{#if !loadTiles}
			<button
				type="button"
				class="absolute inset-0 text-sm font-medium"
				onclick={() => (loadTiles = true)}>Load map preview</button
			>
		{/if}
	</div>
	<Link
		{href}
		aria-label="Open shared location in OpenStreetMap"
		class={buttonVariants({ variant: "secondary", class: "w-full" })}
	>
		<NavigationArrowIcon weight="fill" />
		Open map
	</Link>
</div>
