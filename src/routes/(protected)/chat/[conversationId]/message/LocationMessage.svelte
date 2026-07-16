<script lang="ts">
	import type { LocationMessage } from "$lib/model/messaging/messages";
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";
	import { MapPinIcon } from "phosphor-svelte";
	import Link from "$lib/components/ui/link/Link.svelte";

	let {
		message,
	}: {
		message: LocationMessage["body"];
	} = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());

	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
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

	<Link href="https://www.google.com/maps/place/{message.lat},{message.lon}">
		<div class="flex items-center justify-between gap-1">
			<div class="flex-none">
				<MapPinIcon class="size-6 text-red-800" weight="fill" />
			</div>
			<div>
				<div class="font-semibold">Location shared</div>
				<div>view</div>
			</div>
		</div>
	</Link>
	{@render adornments?.()}
</div>
