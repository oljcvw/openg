<script lang="ts">
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import * as Avatar from "$lib/components/ui/avatar";
	import { getNow, subscribeNow } from "$lib/util/now.svelte";

	let {
		profileId,
		displayName,
		mediaHash,
		onlineUntil,
	}: {
		profileId: number;
		displayName: string | null;
		mediaHash: string | null;
		onlineUntil: number | null;
	} = $props();

	$effect(() => subscribeNow());
	const online = $derived(onlineUntil !== null && onlineUntil > getNow());
</script>

<a
	class="relative isolate inline-block rounded-full focus-visible:ring-3 focus-visible:ring-ring/40"
	href="/profile/{profileId}"
	aria-label="View {displayName ?? 'profile'}"
>
	<Avatar.Root class="size-16 *:rounded-full">
		<UserAvatar
			{mediaHash}
			class="size-16 overflow-hidden rounded-full bg-neutral-700 *:rounded-full"
		/>
		{#if online}
			<Avatar.Badge class="bg-green-500" />
			<span class="sr-only">Online now</span>
		{/if}
	</Avatar.Root>
</a>
