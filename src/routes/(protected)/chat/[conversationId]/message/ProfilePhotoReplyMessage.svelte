<script lang="ts">
	import type { ProfilePhotoReplyMessage } from "$lib/model/messaging/messages";
	import { profileMediaUrl } from "$lib/util/media";
	import type { ConversationState } from "../conversation-state.svelte";
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";

	let {
		message,
		profile,
	}: {
		message: ProfilePhotoReplyMessage["body"];
		profile: ConversationState["profile"];
	} = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});

	let replyToHeader = $derived.by(() => {
		if (isOut) {
			return `Reply to "${profile?.name ? profile.name : "Someone"}"`;
		}
		return "Reply to You";
	});
</script>

<div
	class={[
		"relative w-fit max-w-100 shrink-0 overflow-visible rounded-xl px-3 py-2 text-black select-text",
		{
			"pointer-coarse:select-none": !clone,
			"bg-message-bubble-in": !isOut,
			"ms-3": !isOut && !clone,
			"rounded-es-none": lastInStack && !isOut,
			"bg-message-bubble-out": isOut,
			"me-3": isOut && !clone,
			"rounded-ee-none": lastInStack && isOut,
		},
	]}
	bind:this={el}
>
	{#if lastInStack}
		<MessageTail
			{isOut}
			class={{
				"fill-message-bubble-in": !isOut,
				"fill-message-bubble-out": isOut,
			}}
		/>
	{/if}

	<div
		class="relative mb-2 flex justify-between gap-2 overflow-hidden rounded-sm bg-white/60 px-3 py-1 text-xs
        after:absolute after:top-0 after:bottom-0 after:left-0 after:w-1 after:bg-white/60 after:content-['']"
	>
		<div>
			<div class="font-semibold">{replyToHeader}</div>
			<div>Image</div>
		</div>
		<div class="flex-none">
			<img
				src={profileMediaUrl(message.imageHash, "thumb")}
				alt=""
				class="size-10"
			/>
		</div>
	</div>

	<span class="whitespace-pre-wrap">{message.photoContentReply}</span>
	{@render adornments?.()}
</div>
