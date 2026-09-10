<script lang="ts">
	import { MapPinIcon } from "phosphor-svelte";
	import { Map, Marker, TileLayer } from "sveaflet";

	import { openExternalLink } from "$lib/platform/link-opener";
	import type { LocationMessage } from "$lib/model/messaging/messages";
	import { messageRef } from "./context";

	let {
		message,
	}: {
		message: LocationMessage["body"];
	} = $props();

	const ref = messageRef();

	function openMaps() {
		const url = `https://www.google.com/maps/search/?api=1&query=${message.lat},${message.lon}`;
		openExternalLink(url);
	}
</script>

<button
	type="button"
	class="relative overflow-hidden rounded-lg w-48 h-32 md:w-64 md:h-48 cursor-pointer border border-border bg-muted isolate"
	onclick={openMaps}
	{@attach ref}
>
	<div class="pointer-events-none absolute inset-0 z-10"></div>
	<Map
		options={{
			center: [message.lat, message.lon],
			zoom: 14,
			zoomControl: false,
			attributionControl: false,
			dragging: false,
			touchZoom: false,
			scrollWheelZoom: false,
			doubleClickZoom: false,
			boxZoom: false,
			keyboard: false,
		}}
	>
		<TileLayer
			url={"https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
			options={{ maxZoom: 19 }}
		/>
		<Marker latLng={[message.lat, message.lon]} />
	</Map>
	<div
		class="absolute bottom-2 right-2 z-20 flex size-8 items-center justify-center rounded-full bg-background/80 shadow-sm backdrop-blur-md"
	>
		<MapPinIcon weight="fill" class="size-5 text-foreground" />
	</div>
</button>
