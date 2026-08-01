<script lang="ts">
	import type { GiphyMessage } from "$lib/model/messaging/messages";
	import { MessageMediaState } from "./message-media.svelte";

	let { message }: { message: GiphyMessage["body"] } = $props();
	const media = new MessageMediaState();
	let animated = $state(false);
	let animationFailed = $state(false);
	const still = $derived(message.stillPath || message.previewPath);
	const source = $derived(
		animated && !animationFailed && !media.clone ? message.urlPath : still,
	);
	const ratio = $derived(
		message.width > 0 && message.height > 0
			? `${Math.min(message.width, 4096)} / ${Math.min(message.height, 4096)}`
			: undefined,
	);
</script>

<button
	type="button"
	bind:this={media.el}
	class={[
		"relative block w-2/5 max-w-60 min-w-35 overflow-hidden rounded-lg bg-card",
		media.cornerClass,
		{ "ms-3": !media.clone },
	]}
	style:aspect-ratio={ratio}
	disabled={media.clone}
	onclick={() => {
		animated = !animated;
		if (animated) animationFailed = false;
	}}
	aria-label={animated ? "Pause GIF" : "Play GIF"}
>
	<img
		src={source}
		alt="GIF"
		class="size-full object-cover"
		draggable="false"
		onerror={() => {
			if (animated) {
				animationFailed = true;
				animated = false;
			}
		}}
	/>
	<span
		class="absolute right-1 bottom-1 rounded bg-black/65 px-1 text-xs text-white"
		>GIF</span
	>
	{@render media.adornments?.()}
</button>
