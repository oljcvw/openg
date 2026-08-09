<script lang="ts">
	import * as Command from "$lib/components/ui/command";
	import { openAppDetail } from "$lib/navigation/app-navigation";
	import { commandCenterClose } from "../command-center-state.svelte";

	let {
		profileId,
	}: {
		profileId: number | null;
	} = $props();
</script>

<Command.Item
	value={profileId === null ? "#" : `#${profileId}`}
	disabled={profileId === null}
	class={profileId === null ? "text-muted-foreground" : undefined}
	onSelect={() => {
		void openAppDetail("/profile/" + profileId);
		commandCenterClose();
	}}
>
	{#if profileId === null}
		Enter the profile ID to search
	{:else}
		#{profileId}
	{/if}
</Command.Item>
