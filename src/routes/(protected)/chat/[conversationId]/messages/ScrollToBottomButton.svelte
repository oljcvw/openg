<script lang="ts">
	import { CaretDownIcon } from "phosphor-svelte";
	import { sineOut } from "svelte/easing";
	import { fly } from "svelte/transition";

	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import { getConversationState } from "../conversation-state.svelte";

	let {
		onclick,
		seenTimestamp,
	}: {
		onclick: () => void;
		seenTimestamp: number;
	} = $props();

	const conversationState = $derived(getConversationState()());

	const unreadCount = $derived(
		conversationState.messages.filter(
			(m) =>
				m.senderId !== conversationState.ourProfileId &&
				m.timestamp > seenTimestamp,
		).length,
	);
</script>

<div
	class="absolute right-3 z-2"
	style:bottom="calc(var(--chat-ime-offset, 0px) + var(--composer-height) +
	var(--chat-composer-overlay-height, 0px) + 0.75rem)"
	transition:fly={{ y: 48, opacity: 0, duration: 200, easing: sineOut }}
>
	<Button
		variant="outline"
		size="icon-lg"
		aria-label="Scroll to newest messages"
		class="shadow-sm backdrop-blur-2xl dark:bg-background/60"
		onclick={() => onclick()}
	>
		<CaretDownIcon />
	</Button>
	{#if unreadCount > 0}
		<Badge
			class="pointer-events-none absolute -top-1.5 -right-1.5 min-w-5 px-unread-badge-inline"
		>
			{unreadCount}
		</Badge>
	{/if}
</div>
