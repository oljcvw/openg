<script lang="ts">
	import { page } from "$app/state";
	import ChatCircleIcon from "phosphor-svelte/lib/ChatCircleIcon";
	import StarIcon from "phosphor-svelte/lib/StarIcon";

	import { tabsListVariants } from "$lib/components/ui/tabs";

	const chatsRouteIds = new Set([
		"/(protected)/chat",
		"/(protected)/chat/[conversationId]",
	]);

	const isChatsActive = $derived(
		page.route.id !== null && chatsRouteIds.has(page.route.id),
	);
	const isFavoritesActive = $derived(
		page.route.id === "/(protected)/chat/favorites",
	);
</script>

<nav class="sticky top-0 z-10 rounded-full bg-background/85 p-1 backdrop-blur-sm">
	<div
		class={[
			tabsListVariants({ variant: "default" }),
			"grid w-full grid-cols-2 [&>a]:justify-center",
		]}
	>
		<a href="/chat" data-active={isChatsActive}>
			<ChatCircleIcon weight="fill" />
			Chats
		</a>
		<a href="/chat/favorites" data-active={isFavoritesActive}>
			<StarIcon weight="fill" />
			Favorites
		</a>
	</div>
</nav>

<style lang="postcss">
	@reference "../../layout.css";

	a {
		@apply rounded-full border border-transparent! px-3 py-2 text-sm data-active:font-medium focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:bg-input/20 dark:text-muted-foreground dark:hover:bg-input/20 relative inline-flex h-[calc(100%-1px)] items-center gap-2 whitespace-nowrap focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 data-active:text-foreground;
	}
</style>
