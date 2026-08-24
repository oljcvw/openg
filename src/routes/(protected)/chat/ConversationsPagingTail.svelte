<script lang="ts">
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import { observeIntersection } from "$lib/util/observe-intersection";
	import type { InboxPaging } from "$lib/chat/inbox-paging.svelte";
	import EmptyConversationSearch from "./EmptyConversationSearch.svelte";
	import EmptyConversationsList from "./EmptyConversationsList.svelte";

	let {
		paging,
		hasMore,
		listEmpty,
		filtered,
		query = "",
		searchingHistory = false,
		searchFailure = null,
		onSearchRetry,
	}: {
		paging: InboxPaging;
		hasMore: boolean;
		listEmpty: boolean;
		filtered: boolean;
		query?: string;
		searchingHistory?: boolean;
		searchFailure?: Error | null;
		onSearchRetry?: () => void;
	} = $props();

	const failure = $derived(searchFailure ?? paging.failure);
</script>

<div role="status" class="sr-only">
	{paging.running
		? "Loading more conversations"
		: searchingHistory
			? "Searching message history"
			: failure
				? searchFailure
					? "Failed to search message history"
					: "Failed to load more conversations"
				: ""}
</div>
{#if listEmpty && !hasMore && !searchingHistory && !failure}
	{#if query.trim()}
		<EmptyConversationSearch {query} />
	{:else}
		<EmptyConversationsList {filtered} />
	{/if}
{/if}
{#if failure}
	<div class={["flex", { "flex-1": listEmpty }]}>
		<ApiErrorDisplay
			error={failure}
			onRetry={() => (onSearchRetry ? onSearchRetry() : paging.retry())}
			class="m-auto"
		/>
	</div>
{:else}
	{#if (hasMore && (paging.running || listEmpty)) || (listEmpty && searchingHistory)}
		{#each Array(listEmpty ? 8 : 6)}
			<Skeleton class="h-24.5 w-full shrink-0" />
		{/each}
	{/if}
	{#if hasMore}
		{#key paging.armToken}
			<div
				class="h-0"
				use:observeIntersection={{
					handle: () => paging.run(),
					rootMargin: "400px",
				}}
			></div>
		{/key}
	{/if}
{/if}
