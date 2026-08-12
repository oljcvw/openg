<script lang="ts">
	import * as Command from "$lib/components/ui/command";
	import { activateAppRootRoute } from "$lib/navigation/app-navigation";
	import { commandCenterClose } from "../command-center-state.svelte";

	let {
		link,
		value,
	}: {
		link: string;
		value: string;
	} = $props();
</script>

<Command.Item
	value="/{value}"
	onSelect={() => {
		void activateAppRootRoute(link);
		commandCenterClose();
	}}
>
	/{value}
</Command.Item>
