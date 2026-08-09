<script lang="ts">
	import type { Component } from "svelte";

	let {
		Root,
	}: {
		Root: Component<{ open?: boolean }>;
	} = $props();
	let open = $state(true);
</script>

<Root bind:open />
<output data-testid="open-state">{open ? "open" : "closed"}</output>
<button type="button" onclick={() => (open = true)}>Reopen</button>
