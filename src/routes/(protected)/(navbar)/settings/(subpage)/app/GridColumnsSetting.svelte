<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getGridColumnsSnapshot,
		getPreferences,
		type GridColumns,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import * as Item from "$lib/components/ui/item";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";

	let value = $state<GridColumns>(getGridColumnsSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.gridColumns;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load Browse grid density", error);
			});
	});

	function save(next: string) {
		if (next === "") return;
		const previous = value;
		value = next === "auto" ? "auto" : Number(next);
		setPreferences({ gridColumns: value }).catch((error) => {
			value = previous;
			showErrorToast({
				label: "Failed to save Browse grid density",
				error,
			});
		});
	}
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Browse grid density</Item.Title>
		<Item.Description>
			Choose how many profiles appear across the Browse grid.
		</Item.Description>
	</Item.Content>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		class="flex w-full flex-wrap"
		disabled={!loaded}
		bind:value={() => String(value), save}
	>
		<ToggleGroup.Item value="auto" class="min-w-14 flex-1 justify-center">
			Auto
		</ToggleGroup.Item>
		{#each [2, 3, 4, 5, 6, 7] as columns}
			<ToggleGroup.Item
				value={String(columns)}
				aria-label="{columns} profiles across"
				class="min-w-9 flex-1 justify-center"
			>
				{columns}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
</Item.Root>
