<script lang="ts">
	import { CaretRightIcon, ImagesSquareIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
</script>

<Item.Root variant="default" class="rounded-none border-0">
	{#snippet child({ props })}
		<a
			href="/settings/albums"
			onclick={(event) =>
				interceptAppNavigationClick(event, () =>
					openAppDetail("/settings/albums"),
				)}
			{...props}
		>
			<Item.Media><ImagesSquareIcon weight="fill" class="size-5" /></Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title>Manage albums</Item.Title>
				<Item.Description>Live albums and saved album sets</Item.Description>
			</Item.Content>
			<Item.Actions><CaretRightIcon class="size-4" /></Item.Actions>
		</a>
	{/snippet}
</Item.Root>
