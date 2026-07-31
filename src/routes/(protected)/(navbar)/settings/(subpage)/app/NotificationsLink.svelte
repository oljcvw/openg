<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<a href="/settings/app/notifications" {...props}>
			<Item.Content class="max-cramped:min-w-0">
				<Item.Title class="inline-block max-w-full min-w-0 truncate">
					Notifications
				</Item.Title>
				<Item.Description>
					Background checks for messages and taps on Android.
				</Item.Description>
			</Item.Content>
			<Item.Actions class="min-w-0">
				<CaretRightIcon class="size-4 shrink-0" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
