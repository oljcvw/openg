<script lang="ts">
	import VirtualCollection from "./VirtualCollection.svelte";

	let {
		count = 1_000,
		estimateSize = 80,
		measurementKey = 0,
	}: {
		count?: number;
		estimateSize?: number;
		measurementKey?: string | number;
	} = $props();
	let viewport: HTMLDivElement | null = $state(null);
	const items = $derived(
		Array.from({ length: count }, (_, index) => ({ id: index + 1 })),
	);
</script>

<div
	bind:this={viewport}
	data-testid="viewport"
	style="height: 640px; overflow: auto"
>
	<VirtualCollection
		{items}
		scrollElement={viewport}
		getKey={(item) => item.id}
		{estimateSize}
		{measurementKey}
	>
		{#snippet children(item)}
			<div data-fixture-item={item.id}>{item.id}</div>
		{/snippet}
	</VirtualCollection>
</div>
