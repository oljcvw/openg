<script lang="ts">
	import type { Snippet } from "svelte";

	import {
		interceptAppNavigationClick,
		replaceAppDetail,
	} from "$lib/navigation/app-navigation";
	import { getMessageContext, getMessageMetaContext } from "./context";
	import MessageTail from "./MessageTail.svelte";

	let {
		title,
		description,
		href,
		children,
	}: {
		title: string;
		description?: string | null;
		href?: string | null;
		children?: Snippet;
	} = $props();

	const { lastInStack, isOut } = $derived(getMessageContext()());
	const { clone, setRef, adornments } = $derived(getMessageMetaContext()());
	let el: HTMLElement | null = $state(null);
	$effect(() => setRef(el));
</script>

{#snippet content()}
	{#if lastInStack}
		<MessageTail {isOut} class="fill-card" />
	{/if}
	{@render children?.()}
	<div class="font-medium text-foreground">{title}</div>
	{#if description}
		<div class="text-xs text-muted-foreground">{description}</div>
	{/if}
	{@render adornments?.()}
{/snippet}

{#if href}
	<a
		bind:this={el}
		{href}
		onclick={(event) =>
			interceptAppNavigationClick(event, () => replaceAppDetail(href))}
		class={[
			"relative block w-fit max-w-80 rounded-xl bg-card px-3 py-2 text-start shadow-sm",
			{ "ms-3": !isOut && !clone, "me-3": isOut && !clone },
		]}
	>
		{@render content()}
	</a>
{:else}
	<div
		bind:this={el}
		class={[
			"relative w-fit max-w-80 rounded-xl bg-card px-3 py-2 text-start shadow-sm",
			{ "ms-3": !isOut && !clone, "me-3": isOut && !clone },
		]}
	>
		{@render content()}
	</div>
{/if}
