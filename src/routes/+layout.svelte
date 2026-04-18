<script lang="ts">
	import "../layout.css";
	import favicon from "$lib/assets/favicon.png";
	import { Toaster } from "svelte-french-toast";

	let {
		children,
	}: {
		children?: import("svelte").Snippet;
	} = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>
<Toaster
	position="bottom-center"
	toastOptions={{
		style: "background-color: var(--accent); color: var(--popover)",
	}}
/>
{@render children?.()}
