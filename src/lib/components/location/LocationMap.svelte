<script lang="ts">
	import { divIcon } from "leaflet";
	import { ControlAttribution, Map, Marker, TileLayer } from "sveaflet";

	import type { LocationPoint } from "$lib/model/location";

	let {
		point,
		loadTiles = false,
	}: { point: LocationPoint; loadTiles?: boolean } = $props();
</script>

<div
	class="pointer-events-none relative h-full min-h-36 w-full overflow-clip rounded-xl bg-muted"
>
	{#if loadTiles}
		<Map
			options={{
				attributionControl: false,
				boxZoom: false,
				center: [point.lat, point.lon],
				doubleClickZoom: false,
				dragging: false,
				keyboard: false,
				scrollWheelZoom: false,
				touchZoom: false,
				zoom: 15,
				zoomControl: false,
			}}
		>
			<TileLayer
				url={"https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
				options={{
					maxZoom: 19,
					attribution:
						'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer nofollow noopener">OpenStreetMap</a>',
				}}
			/>
			<ControlAttribution options={{ prefix: undefined }} />
			<Marker
				latLng={[point.lat, point.lon]}
				options={{
					interactive: false,
					icon: divIcon({
						html: '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" fill="#ffba20" stroke="#000000" stroke-width="8px" viewBox="0 0 256 256"><path d="M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z"></path></svg>',
						iconAnchor: [17, 34],
						iconSize: [34, 34],
						className: "",
					}),
				}}
			/>
		</Map>
	{:else}
		<div class="flex h-full min-h-36 items-center justify-center bg-muted">
			<div class="flex flex-col items-center gap-2 text-muted-foreground">
				<span class="text-4xl text-primary">●</span>
				<span class="text-sm font-medium">Location preview hidden</span>
			</div>
		</div>
	{/if}
</div>
