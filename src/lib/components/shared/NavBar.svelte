<script lang="ts">
	import { page } from "$app/state";
	import ChatCircleIcon from "phosphor-svelte/lib/ChatCircleIcon";
	import DotsNineIcon from "phosphor-svelte/lib/DotsNineIcon";
	import DropIcon from "phosphor-svelte/lib/DropIcon";
	import FireIcon from "phosphor-svelte/lib/FireIcon";

	import { getMyProfile } from "$lib/api/users/profiles";
	import { getOrCreateConversationsState } from "$lib/chat/conversations-context.svelte";
	import BrokenUserAvatar from "$lib/components/profile/BrokenUserAvatar.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import { tabsListVariants } from "$lib/components/ui/tabs";
	import {
		activateAppRoot,
		interceptAppNavigationClick,
	} from "$lib/navigation/app-navigation";
	import type { ConversationsState } from "$lib/chat/conversations-state.svelte";

	const myProfile = getMyProfile();
	const myProfilePhotos = myProfile.then((profile) => profile.medias);

	let conversations = $state<ConversationsState | null>(null);
	myProfile
		.then((profile) => {
			conversations = getOrCreateConversationsState(profile.profileId);
		})
		.catch(console.error);
	const hasUnread = $derived(conversations?.hasUnread ?? false);
</script>

<ProgressiveBlur
	direction="bottomToTop"
	tag="nav"
	class="fixed bottom-0 z-50 w-full pt-2 pb-fixed-nav"
	bgClass="bg-linear-to-t from-background to-transparent"
	contentClass="overflow-auto no-scrollbar mx-auto flex w-full max-w-5xl justify-center gap-[clamp(0.5rem,2vw,1rem)] px-[clamp(0.5rem,2vw,1.5rem)]"
>
	<div
		class={[
			tabsListVariants({ variant: "default" }),
			"links min-w-0 flex-1 [&>a>svg]:size-[clamp(1.25rem,3.5vw,1.75rem)]!",
		]}
	>
		<a
			href="/"
			data-active={page.route.id === "/(protected)/(navbar)/(root)"}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => activateAppRoot("browse"))}
		>
			<DotsNineIcon weight="fill" />
			Browse
		</a>
		<a
			href="/right-now"
			data-active={page.route.id === "/(protected)/(navbar)/right-now"}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => activateAppRoot("rightNow"))}
		>
			<DropIcon weight="fill" />
			Right Now
		</a>
		<a
			href="/interest/taps"
			data-active={page.route.id?.startsWith("/(protected)/(navbar)/interest")}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => activateAppRoot("interest"))}
		>
			<FireIcon weight="fill" />
			Interest
		</a>
		<a
			href="/chat"
			data-active={page.route.id?.startsWith("/(protected)/chat") ||
				page.route.id?.startsWith("/(protected)/albums")}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => activateAppRoot("inbox"))}
		>
			<ChatCircleIcon weight="fill" />
			Inbox
			{#if hasUnread}
				<Badge class="absolute inset-e-2 top-1 size-2.5 rounded-full p-0" />
			{/if}
		</a>
	</div>
	<a
		href="/settings"
		aria-label="Settings"
		onclick={(event) =>
			interceptAppNavigationClick(event, () => activateAppRoot("settings"))}
		class={[
			"flex size-[calc(var(--nav-height)-0.5rem)] shrink-0 rounded-full border bg-muted p-1",
			{
				"border-2 border-accent": page.route.id?.startsWith(
					"/(protected)/(navbar)/settings",
				),
				"border-border": !page.route.id?.startsWith(
					"/(protected)/(navbar)/settings",
				),
			},
		]}
	>
		{#await myProfilePhotos then photos}
			{@const mainPhoto = photos[0] as { mediaHash: string } | undefined}
			<UserAvatar
				mediaHash={mainPhoto?.mediaHash ?? null}
				class="size-full *:rounded-full"
				size="lg"
			/>
		{:catch}
			<BrokenUserAvatar />
		{/await}
	</a>
</ProgressiveBlur>

<style lang="postcss">
	@reference "$layout";

	.links a {
		@apply relative inline-flex h-[calc(100%-1px)] flex-1 flex-col items-center justify-center gap-0.5 rounded-full border border-transparent! px-[clamp(0.5rem,2vw,1rem)] py-1 whitespace-nowrap text-foreground/60 group-data-vertical/tabs:rounded-2xl group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 hover:bg-input/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-input/20 data-active:font-medium data-active:text-foreground dark:data-active:border-input dark:data-active:text-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4;
		font-size: clamp(0.75rem, 2vw, 0.9375rem);
	}

	.links {
		width: 100%;
		min-height: calc(var(--nav-height) - 0.5rem);
	}
</style>
