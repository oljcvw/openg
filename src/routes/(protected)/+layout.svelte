<script lang="ts">
	import { onMount } from "svelte";

	import { callMethod } from "$lib/api";
	import CommandCenter from "$lib/components/command-center/CommandCenter.svelte";
	import { reconcilePendingProfileLocation } from "$lib/location/profile-location";

	let {
		children,
	}: {
		children: import("svelte").Snippet;
	} = $props();

	onMount(() => {
		void reconcilePendingProfileLocation().catch((error) => {
			console.error("Failed to reconcile pending profile location", error);
		});
		void callMethod("notification_sync").catch((error) => {
			console.error("Failed to sync notification schedule", error);
		});
	});
</script>

{@render children()}
<CommandCenter />
