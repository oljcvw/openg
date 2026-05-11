<script lang="ts">
	import { NavigationArrowIcon } from "phosphor-svelte";
	import { formatMetricDistance } from "$lib/utils";

	let { distance }: { distance: number | null } = $props();
</script>

{#if distance !== null}
	<span class="flex items-center gap-1 whitespace-nowrap">
		<NavigationArrowIcon weight="fill" class="rotate-y-180 shrink-0" />
		{formatMetricDistance(distance)}
	</span>
{/if}
