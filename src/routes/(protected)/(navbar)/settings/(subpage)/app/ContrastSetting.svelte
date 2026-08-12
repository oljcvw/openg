<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		type ContrastMode,
		getContrastModeSnapshot,
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import * as Item from "$lib/components/ui/item";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";

	let value = $state<ContrastMode>(getContrastModeSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.contrastMode;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load contrast preference", error);
			});
	});

	function save(next: string) {
		if (next !== "standard" && next !== "high") return;
		const previous = value;
		value = next;
		setPreferences({ contrastMode: next }).catch((error) => {
			value = previous;
			showErrorToast({
				label: "Failed to save contrast preference",
				error,
			});
		});
	}
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Color contrast</Item.Title>
		<Item.Description>
			Increase text, control, and boundary contrast across the app.
		</Item.Description>
	</Item.Content>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		class="w-full"
		disabled={!loaded}
		bind:value={() => value, save}
	>
		<ToggleGroup.Item value="standard" class="flex-1 justify-center">
			Standard
		</ToggleGroup.Item>
		<ToggleGroup.Item value="high" class="flex-1 justify-center">
			High
		</ToggleGroup.Item>
	</ToggleGroup.Root>
</Item.Root>
