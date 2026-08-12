<script lang="ts">
	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import ProfileFacts from "$lib/components/profile/ProfileFacts.svelte";
	import ProfileItem from "$lib/components/profile/ProfileItem.svelte";
	import TapIcon from "$lib/components/profile/TapIcon.svelte";
	import RelativeTimeDynamic from "$lib/components/shared/RelativeTimeDynamic.svelte";
	import * as Item from "$lib/components/ui/item";
	import type { ProfileSummary } from "$lib/api/users/profiles";
	import type { TapProfile } from "$lib/model/interest/tap-profile";

	let {
		tap,
		summary,
	}: {
		tap: TapProfile;
		summary: ProfileSummary | null;
	} = $props();
</script>

<ProfileItem
	avatar={{ mediaHash: tap.profileImageMediaHash }}
	title={{ value: tap.displayName }}
	onlineUntil={tap.onlineUntil}
	link="/profile/{tap.profileId}"
	compact
>
	{#snippet description()}
		<div class="flex min-w-0 flex-col gap-1">
			{#if tap.distance !== null}
				<Item.Description class="text-muted-foreground">
					<DistanceFormatted distance={tap.distance} />
				</Item.Description>
			{/if}
			<ProfileFacts
				profileId={tap.profileId}
				{summary}
				class="hidden md:flex"
			/>
		</div>
	{/snippet}
	{#snippet actions()}
		<Item.Actions class="flex min-w-6 flex-col items-end gap-1 @max-row:hidden">
			<span
				class="max-w-full truncate text-right font-medium text-muted-foreground"
			>
				<RelativeTimeDynamic date={tap.timestamp} />
			</span>
			{#if tap.tapType !== null}
				<TapIcon tapType={tap.tapType} />
			{/if}
		</Item.Actions>
	{/snippet}
</ProfileItem>
