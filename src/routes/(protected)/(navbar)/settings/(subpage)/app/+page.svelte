<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import ToastUnimplemented from "$lib/components/feedback/ToastUnimplemented.svelte";
	import * as Item from "$lib/components/ui/item";
	import GridColumnsSetting from "./GridColumnsSetting.svelte";
	import RevealMessageReadSetting from "./RevealMessageReadSetting.svelte";
	import RevealProfileViewSetting from "./RevealProfileViewSetting.svelte";
	import StayAwakeSetting from "./StayAwakeSetting.svelte";
	import UnitsSetting from "./UnitsSetting.svelte";
</script>

{#snippet item({
	title,
	unimplemented,
}: {
	title: string;
	unimplemented: { feature: string; issue: number };
})}
	<Item.Root variant="outline">
		{#snippet child({ props })}
			<a
				href="#/"
				{...props}
				onclick={(event) => {
					event.preventDefault();
					toast(ToastUnimplemented, {
						componentProps: unimplemented,
					});
				}}
			>
				<Item.Content class="max-cramped:min-w-0">
					<Item.Title class="inline-block max-w-full min-w-0 truncate">
						{title}
					</Item.Title>
				</Item.Content>
				<Item.Actions class="min-w-0">
					<!-- <Item.Description class="min-w-0">{value}</Item.Description> -->
					<CaretRightIcon class="size-4 shrink-0" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
{/snippet}
<h2>Display</h2>
<UnitsSetting />
<GridColumnsSetting />
<StayAwakeSetting />
<h2>Notifications</h2>
{@render item({
	title: "Notifications",
	unimplemented: { feature: "Notifications", issue: 45 },
})}
<h2>Privacy</h2>
<RevealMessageReadSetting />
<RevealProfileViewSetting />

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply mt-2 truncate ps-4 text-xl font-semibold tracking-tight;
	}
</style>
