<script lang="ts">
	import { getConversationMediaViewer } from "$lib/chat/conversation-media-viewer.svelte";
	import type { ImageMessage } from "$lib/model/messaging/messages";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		messageId,
	}: {
		message: ImageMessage["body"];
		messageId: string;
	} = $props();

	const media = new MessageMediaState();
	const viewer = getConversationMediaViewer()();

	function openImage(opener: HTMLButtonElement): void {
		viewer.open({
			items: [{ id: messageId, kind: "image", url: message.url }],
			startId: messageId,
			messageId,
			opener,
		});
	}
</script>

<div
	class={["relative", { "ms-3 w-2/5 max-w-60 min-w-35": !media.clone }]}
	bind:this={media.el}
>
	<button
		type="button"
		aria-label="Open image"
		class="item block w-full appearance-none border-0 bg-transparent p-0"
		onclick={(event) => openImage(event.currentTarget)}
	>
		<img
			src={message.url}
			alt=""
			loading="lazy"
			decoding="async"
			class={[
				"w-full rounded-lg bg-card-foreground/10 object-cover",
				media.cornerClass,
			]}
			style:aspect-ratio={message.width !== null && message.height !== null
				? `${message.width} / ${message.height}`
				: undefined}
			draggable="false"
		/>
	</button>
	{@render media.adornments?.()}
</div>
