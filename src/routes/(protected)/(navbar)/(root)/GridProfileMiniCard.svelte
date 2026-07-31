<script lang="ts">
	import ProfileMiniCard from "$lib/components/profile/ProfileMiniCard.svelte";

	let {
		id,
		displayName = null,
		age = null,
		distance = null,
		medias = null,
		unread = null,
		onlineUntil = null,
		isFavorite = false,
		isRightNow = false,
		isVisiting = false,
		hadRecentChat = false,
	}: {
		id: number;
		displayName?: string | null;
		age?: number | null;
		distance?: number | null;
		medias?: { mediaHash: string }[] | null;
		unread?: number | null;
		onlineUntil?: number | null;
		isFavorite?: boolean;
		isRightNow?: boolean;
		isVisiting?: boolean;
		hadRecentChat?: boolean;
	} = $props();
</script>

<ProfileMiniCard
	mediaHash={medias?.[0]?.mediaHash ?? null}
	{displayName}
	{age}
	{distance}
	{unread}
	{onlineUntil}
	{isFavorite}
	{isRightNow}
	{isVisiting}
	{hadRecentChat}
	href="/profile/{id}?from=browse"
/>
