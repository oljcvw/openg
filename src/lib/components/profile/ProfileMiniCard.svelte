<script lang="ts">
	import { ChatIcon, StarIcon } from "phosphor-svelte";
	import type { Snippet } from "svelte";

	import { getShowLastOnlineOverlaySnapshot } from "$lib/app-data/preferences.svelte";
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import ProfileLastOnlineOverlay from "$lib/components/profile/ProfileLastOnlineOverlay.svelte";
	import ProfileStatusIndicator from "$lib/components/profile/ProfileStatusIndicator.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import { Badge } from "$lib/components/ui/badge";

	let {
		mediaHash = null,
		displayName = null,
		age = null,
		distance = null,
		unread = null,
		onlineUntil = null,
		lastOnline = null,
		isFavorite = false,
		isVisiting = false,
		hadRecentChat = false,
		href = null,
		class: className,
		overlay,
	}: {
		mediaHash?: string | null;
		displayName?: string | null;
		age?: number | null;
		distance?: number | null;
		unread?: number | null;
		onlineUntil?: number | null;
		lastOnline?: number | null;
		isFavorite?: boolean;
		isVisiting?: boolean;
		hadRecentChat?: boolean;
		href?: string | null;
		class?: import("svelte/elements").ClassValue;
		overlay?: Snippet;
	} = $props();

	const showLastOnlineOverlay = $derived(getShowLastOnlineOverlaySnapshot());
</script>

{#snippet content()}
	<div class="absolute size-full bg-stone-700">
		<UserAvatar {mediaHash} class="size-full" size="xl" />
	</div>
	{#if showLastOnlineOverlay || distance !== null}
		<div class="absolute inset-x-1 top-1 z-2 flex min-w-0 items-start justify-between gap-1">
			{#if showLastOnlineOverlay}
				<ProfileLastOnlineOverlay
					{onlineUntil}
					{lastOnline}
					class="min-w-0 max-w-[65%]"
				/>
			{/if}
			{#if distance !== null}
				<span class="profile-card-distance ms-auto shrink-0">
					<DistanceFormatted {distance} />
				</span>
			{/if}
		</div>
	{/if}
	{#if isFavorite || hadRecentChat}
		<div
			class={[
				"absolute inset-s-2 z-1 flex w-1/6 flex-col items-center gap-1",
				showLastOnlineOverlay || distance !== null ? "top-8" : "top-2",
			]}
		>
			{#if isFavorite}
				<div class="badge">
					<StarIcon weight="fill" class="m-auto size-4/6 text-yellow-500" />
				</div>
			{/if}
			{#if hadRecentChat}
				<div class="badge">
					<ChatIcon
						weight="fill"
						class="m-auto size-3/5 -translate-y-px text-sky-400"
					/>
				</div>
			{/if}
		</div>
	{/if}
	{#if displayName !== null || age !== null}
		<div class="z-1 flex w-full items-center gap-0.5 p-0.5">
			<Badge
				variant="outline"
				class="max-w-full min-w-0 shrink gap-0 bg-popover/20 backdrop-blur-2xl"
			>
				<ProfileStatusIndicator {onlineUntil} {isVisiting} class="me-1" />

				{#if displayName !== null}
					<span class="block shrink truncate font-semibold">{displayName}</span>
				{/if}
				{#if displayName !== null && age !== null}
					,&nbsp;
				{/if}
				{#if age !== null}
					<span class="line-clamp-1 block max-w-full shrink-0 truncate">
						{age}
					</span>
				{/if}
			</Badge>
			{#if unread !== null && unread > 0}
				<span
					class="flex size-5 shrink-0 items-center justify-center rounded-full border border-black/20 bg-primary text-2xs font-semibold text-primary-foreground"
				>
					{#if unread > 99}
						<span class="text-3xs">99+</span>
					{:else}
						{unread}
					{/if}
				</span>
			{/if}
		</div>
	{/if}
	{@render overlay?.()}
{/snippet}

{#if href !== null}
	<a
		{href}
		class={["relative flex aspect-square items-end overflow-hidden", className]}
	>
		{@render content()}
	</a>
{:else}
	<div
		class={["relative flex aspect-square items-end overflow-hidden", className]}
	>
		{@render content()}
	</div>
{/if}

<style lang="postcss">
	@reference "$layout";

	.badge {
		@apply flex aspect-square h-auto w-full rounded-full border border-white/10 bg-popover/40 backdrop-blur-2xl;
	}
</style>
