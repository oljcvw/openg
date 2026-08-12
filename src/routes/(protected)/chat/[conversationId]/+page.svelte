<script lang="ts">
	import { page } from "$app/state";

	import {
		getAccountSessionSnapshot,
		subscribeAccountGeneration,
	} from "$lib/api/account-caches";
	import { resolveConversationDetailOwner } from "./conversation-detail-identity";
	import ConversationDetail from "./ConversationDetail.svelte";

	let { data }: import("./$types").PageProps = $props();

	if (page.params.conversationId === undefined)
		throw new Error("conversationId is required");

	const conversationId = $derived(page.params.conversationId as string);
	const ourProfileId = $derived(data.ourProfileId);
	let accountSession = $state(getAccountSessionSnapshot());
	$effect(() =>
		subscribeAccountGeneration(() => {
			accountSession = getAccountSessionSnapshot();
		}),
	);
	const detailOwner = $derived(
		resolveConversationDetailOwner({
			accountProfileId: ourProfileId,
			accountSession,
			conversationId,
		}),
	);
</script>

{#if detailOwner}
	{#key detailOwner.key}
		<ConversationDetail identity={detailOwner.identity} />
	{/key}
{/if}
