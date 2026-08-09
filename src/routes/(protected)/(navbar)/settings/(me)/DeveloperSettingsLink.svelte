<script lang="ts">
	import { CaretRightIcon, CodeIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<a
			href="/settings/developer"
			onclick={(event) =>
				interceptAppNavigationClick(event, () =>
					openAppDetail("/settings/developer"),
				)}
			{...props}
		>
			<Item.Media>
				<CodeIcon weight="bold" class="size-5" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="inline-block w-full min-w-0 truncate text-left">
					Developer Settings
				</Item.Title>
			</Item.Content>
			<Item.Actions>
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
