<script lang="ts">
	import { ArrowLeftIcon } from "phosphor-svelte";

	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import { Button } from "$lib/components/ui/button";
	import EditProfileButton from "./EditProfileButton.svelte";
	import FavoriteProfileToggle from "./FavoriteProfileToggle.svelte";
	import ProfileActionsMenu from "./ProfileActionsMenu.svelte";

	let {
		ourProfileId,
		profile,
		onBlocked,
		onBack,
		compact = false,
		hiddenFromAccessibility = false,
		class: className,
	}: {
		ourProfileId: number;
		profile: import("$lib/model/users/profiles").Profile;
		onBlocked: () => void;
		onBack: () => void;
		compact?: boolean;
		hiddenFromAccessibility?: boolean;
		class?: import("svelte/elements").ClassValue;
	} = $props();

	const profileId = $derived(profile.profileId);
	const isOurProfile = $derived(profileId === ourProfileId);
</script>

<nav
	aria-hidden={hiddenFromAccessibility}
	inert={hiddenFromAccessibility}
	class={[
		"absolute inset-x-0 top-0 z-40 flex items-center gap-2 p-2",
		{
			"justify-between": !compact,
			"h-16 bg-background/92 shadow-lg backdrop-blur-xl": compact,
		},
		className,
	]}
>
	<Button
		type="button"
		size="icon-lg"
		variant="secondary"
		aria-label="Back to previous screen"
		class="size-12 shrink-0"
		data-profile-swipe-ignore
		onclick={onBack}
	>
		<ArrowLeftIcon aria-hidden="true" class="size-6" />
	</Button>
	{#if compact}
		<UserAvatar
			mediaHash={profile.medias[0]?.mediaHash ?? null}
			class="size-10 shrink-0 overflow-hidden rounded-full"
		/>
		<div class="min-w-0 flex-1">
			<p class="truncate font-semibold">
				{profile.displayName ?? "Someone"}{#if profile.age !== null}, {profile.age}{/if}
			</p>
			<p class="truncate text-xs text-muted-foreground">Profile</p>
		</div>
	{:else}
		<div class="flex-1"></div>
	{/if}
	<div class="flex flex-row-reverse items-center gap-1.5">
		{#if isOurProfile}
			<EditProfileButton />
		{:else}
			<FavoriteProfileToggle {profileId} bind:isFavorite={profile.isFavorite} />
			<ProfileActionsMenu {profileId} {onBlocked} />
		{/if}
	</div>
</nav>
