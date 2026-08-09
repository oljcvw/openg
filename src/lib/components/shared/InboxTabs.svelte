<script lang="ts">
	import { page } from "$app/state";

	import { tabsListVariants } from "$lib/components/ui/tabs";
	import {
		activateAppRootRoute,
		interceptAppNavigationClick,
	} from "$lib/navigation/app-navigation";

	let {
		class: className,
	}: {
		class?: import("svelte/elements").ClassValue;
	} = $props();

	const albumsActive = $derived(
		page.route.id?.startsWith("/(protected)/albums") ?? false,
	);
</script>

<nav aria-label="Inbox sections" class={[tabsListVariants(), className]}>
	<a
		href="/chat"
		data-active={!albumsActive}
		aria-current={!albumsActive ? "page" : undefined}
		onclick={(event) =>
			interceptAppNavigationClick(event, () => activateAppRootRoute("/chat"))}
	>
		Chats
	</a>
	<a
		href="/albums"
		data-active={albumsActive}
		aria-current={albumsActive ? "page" : undefined}
		onclick={(event) =>
			interceptAppNavigationClick(event, () => activateAppRootRoute("/albums"))}
	>
		Albums
	</a>
</nav>

<style lang="postcss">
	@reference "$layout";

	a {
		@apply inline-flex h-9 flex-1 items-center justify-center rounded-full px-4 text-sm text-muted-foreground transition-colors hover:bg-input/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-active:bg-background data-active:font-medium data-active:text-foreground data-active:shadow-sm;
	}
</style>
