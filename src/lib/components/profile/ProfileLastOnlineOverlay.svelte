<script lang="ts">
	import { formatDistanceStrict } from "date-fns";
	import type { ClassValue } from "svelte/elements";

	import { getNow, subscribeNow } from "$lib/util/now.svelte";

	let {
		onlineUntil = null,
		lastOnline = null,
		class: className,
	}: {
		onlineUntil?: number | null;
		lastOnline?: number | null;
		class?: ClassValue;
	} = $props();

	$effect(() => {
		if (lastOnline !== null || onlineUntil !== null) subscribeNow();
	});

	const online = $derived(onlineUntil !== null && onlineUntil > getNow());
	const label = $derived.by(() => {
		if (online) return "Online";
		if (lastOnline === null) return null;
		return formatDistanceStrict(lastOnline, getNow(), { addSuffix: true });
	});
</script>

{#if label !== null}
	<span
		class={[
			"pointer-events-none truncate rounded-md px-1.5 py-0.5 text-left text-[10px] leading-tight text-white backdrop-blur-sm",
			online ? "bg-green-700/80" : "bg-black/55",
			className,
		]}
	>
		{label}
	</span>
{/if}
