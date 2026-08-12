<script lang="ts">
	import { showErrorToast } from "$lib/api/error";
	import { setPreferences } from "$lib/app-data/preferences.svelte";
	import * as Command from "$lib/components/ui/command";
	import { activateAppRootRoute } from "$lib/navigation/app-navigation";
	import { commandCenterClose } from "../command-center-state.svelte";

	let {
		geohash,
	}: {
		geohash: string | null;
	} = $props();

	async function setLocation(geohash: string) {
		try {
			await setPreferences({ geohash });
			await activateAppRootRoute("/");
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to save location",
				error,
			});
		}
	}
</script>

<Command.Item
	value={geohash === null ? "@" : `@${geohash}`}
	disabled={geohash === null || geohash.length !== 12}
	class={geohash === null ? "text-muted-foreground" : "gap-0 font-mono"}
	onSelect={() => {
		if (geohash === null || geohash.length !== 12) return;
		void setLocation(geohash);
		commandCenterClose();
	}}
>
	{#if geohash === null}
		Enter a 12-character geohash to browse that area
	{:else}
		@{#each Array.from(geohash) as char}
			<span class="w-2.25">{char}</span>
		{/each}
		{#each Array(12 - geohash.length)}
			<span class="ms-px h-px w-2 self-end bg-muted-foreground"></span>
		{/each}
	{/if}
</Command.Item>
