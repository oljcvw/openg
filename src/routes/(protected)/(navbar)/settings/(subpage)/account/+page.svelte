<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
</script>

{#snippet linkItem({ title, href }: { title: string; href: string })}
	<Item.Root variant="outline">
		{#snippet child({ props })}
			<a {href} {...props}>
				<Item.Content class="max-cramped:min-w-0">
					<Item.Title class="inline-block max-w-full min-w-0 truncate">
						{title}
					</Item.Title>
				</Item.Content>
				<Item.Actions class="min-w-0">
					<CaretRightIcon class="size-4 shrink-0" />
				</Item.Actions>
			</a>
		{/snippet}
	</Item.Root>
{/snippet}
{@render linkItem({ title: "Privacy", href: "/settings/account/privacy" })}
{@render linkItem({ title: "Email", href: "/settings/account/email" })}
{@render linkItem({ title: "Password", href: "/settings/account/password" })}
{@render linkItem({
	title: "Blocked users",
	href: "/settings/account/blocked",
})}
{@render linkItem({ title: "Hidden users", href: "/settings/account/hidden" })}
{@render linkItem({
	title: "Delete account",
	href: "/settings/account/delete",
})}
