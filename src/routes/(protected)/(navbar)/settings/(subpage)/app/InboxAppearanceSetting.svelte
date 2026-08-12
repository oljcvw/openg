<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getInboxLayoutModeSnapshot,
		getInboxRowDensitySnapshot,
		getPreferences,
		type InboxLayoutMode,
		type InboxRowDensity,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import * as Item from "$lib/components/ui/item";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";

	let layoutMode = $state<InboxLayoutMode>(getInboxLayoutModeSnapshot());
	let rowDensity = $state<InboxRowDensity>(getInboxRowDensitySnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				layoutMode = preferences.inboxLayoutMode;
				rowDensity = preferences.inboxRowDensity;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load Inbox appearance preferences", error);
			});
	});

	function saveLayout(next: string) {
		if (next !== "adaptive" && next !== "stacked") return;
		const previous = layoutMode;
		layoutMode = next;
		void setPreferences({ inboxLayoutMode: next }).catch((error) => {
			layoutMode = previous;
			showErrorToast({ label: "Failed to save Inbox layout", error });
		});
	}

	function saveDensity(next: string) {
		if (next !== "compact" && next !== "comfortable" && next !== "roomy")
			return;
		const previous = rowDensity;
		rowDensity = next;
		void setPreferences({ inboxRowDensity: next }).catch((error) => {
			rowDensity = previous;
			showErrorToast({ label: "Failed to save Inbox row size", error });
		});
	}
</script>

<Item.Root variant="outline" class="gap-4 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Inbox appearance</Item.Title>
		<Item.Description>
			Choose whether chats use adaptive side-by-side panels and how much space
			each chat or album row targets.
		</Item.Description>
	</Item.Content>

	<div class="grid w-full gap-3">
		<div class="grid gap-1.5">
			<span class="text-sm font-medium">Layout</span>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				class="w-full"
				disabled={!loaded}
				bind:value={() => layoutMode, saveLayout}
			>
				<ToggleGroup.Item value="adaptive" class="flex-1 justify-center">
					Adaptive
				</ToggleGroup.Item>
				<ToggleGroup.Item value="stacked" class="flex-1 justify-center">
					Stacked
				</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>

		<div class="grid gap-1.5">
			<span class="text-sm font-medium">Row size</span>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				class="flex w-full flex-wrap"
				disabled={!loaded}
				bind:value={() => rowDensity, saveDensity}
			>
				<ToggleGroup.Item
					value="compact"
					class="min-w-24 flex-1 justify-center"
				>
					Compact
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="comfortable"
					class="min-w-24 flex-1 justify-center"
				>
					Comfortable
				</ToggleGroup.Item>
				<ToggleGroup.Item value="roomy" class="min-w-24 flex-1 justify-center">
					Roomy
				</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>
	</div>
</Item.Root>
