<script lang="ts">
	import type { Snippet } from "svelte";

	import type { ApiResponseMessage } from "$lib/model/messaging/messages";
	import { setMessageMetaContext } from "./context";
	import ReplyPreview from "./ReplyPreview.svelte";

	let {
		clone = false,
		setRef,
		adornments,
		children,
		replyToMessage,
		ourProfileId,
		otherName,
		onReplySelect,
	}: {
		clone?: boolean;
		setRef: (el: HTMLElement | null) => void;
		adornments?: Snippet;
		children: Snippet;
		replyToMessage?: NonNullable<ApiResponseMessage["replyToMessage"]> | null;
		ourProfileId?: number;
		otherName?: string | null;
		onReplySelect?: () => void;
	} = $props();

	setMessageMetaContext(() => ({
		clone,
		setRef: clone ? () => {} : setRef,
		adornments: clone ? undefined : adornments,
	}));
</script>

<div class="flex w-fit max-w-100 flex-col">
	{#if replyToMessage && ourProfileId !== undefined}
		<ReplyPreview
			message={replyToMessage}
			{ourProfileId}
			{otherName}
			onSelect={clone ? undefined : onReplySelect}
		/>
	{/if}
	{@render children()}
</div>
