<script lang="ts">
	import { ArrowBendUpLeftIcon } from "phosphor-svelte";

	import {
		type ApiResponseMessage,
		previewFromMessage,
		previewLabel,
	} from "$lib/model/messaging/messages";

	let {
		message,
		ourProfileId,
		otherName,
		onSelect,
	}: {
		message: NonNullable<ApiResponseMessage["replyToMessage"]>;
		ourProfileId: number;
		otherName?: string | null;
		onSelect?: () => void;
	} = $props();

	const label = $derived(
		previewLabel(previewFromMessage(message)) ?? "Message",
	);
	const sender = $derived(
		message.senderId === ourProfileId ? "You" : (otherName ?? "Reply"),
	);
</script>

<button
	type="button"
	class="mb-1 flex w-full max-w-100 items-center gap-2 rounded-lg border-s-4 border-primary bg-black/10 px-2 py-1.5 text-left text-xs"
	disabled={!onSelect}
	onclick={onSelect}
	aria-label={`Go to message from ${sender}`}
>
	<ArrowBendUpLeftIcon class="size-4 shrink-0" />
	<span class="min-w-0">
		<strong class="block truncate">{sender}</strong>
		<span class="block truncate opacity-75">{label}</span>
	</span>
</button>
