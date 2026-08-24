<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { tick } from "svelte";

	import { compileConversationSearch } from "$lib/chat/conversation-search";
	import { runConversationSearch } from "$lib/chat/conversation-search-runner";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import { dismissOnBackGesture } from "$lib/platform/back-gesture-event.svelte";
	import { below } from "$lib/util/breakpoints.svelte";
	import { restoreScrollOnce } from "$lib/util/scroll-restore.svelte";
	import { SelectionSet } from "$lib/util/selection.svelte";
	import type { ConversationSearchMatch } from "$lib/chat/conversation-search-index";
	import type { ConversationsState } from "$lib/chat/conversations-state.svelte";
	import Conversation from "./Conversation.svelte";
	import ConversationsFilters from "./ConversationsFilters.svelte";
	import ConversationsPagingTail from "./ConversationsPagingTail.svelte";
	import ConversationsSelectionBar from "./ConversationsSelectionBar.svelte";
	import DeleteConversationsDialog from "./DeleteConversationsDialog.svelte";
	import LazyConversation from "./LazyConversation.svelte";

	const EAGER_COUNT = 10;
	const SEARCH_DEBOUNCE_MS = 250;

	const conversations: ConversationsState = getConversations();
	const mobile = below("split");
	let searchQuery = $state("");
	const compiledSearch = $derived(compileConversationSearch(searchQuery));
	const searching = $derived(compiledSearch.terms.length > 0);
	let searchCacheRevision = $state(0);
	let searchRunning = $state(false);
	let searchFailure: Error | null = $state(null);
	let searchRetryNonce = $state(0);
	let searchGeneration = 0;
	const visibleResults = $derived(
		(() => {
			void searchCacheRevision;
			return conversations.entries.flatMap((conversation) => {
				const match = conversations.searchIndex.getCachedMatch(
					conversation,
					compiledSearch,
				);
				return match ? [{ conversation, match }] : [];
			});
		})(),
	);

	$effect(() => {
		const query = compiledSearch;
		const filterKey = conversations.filters.active.join("\u0000");
		const initialLoading = conversations.loading;
		void filterKey;
		void searchRetryNonce;

		searchGeneration += 1;
		const generation = searchGeneration;
		searchFailure = null;
		if (query.terms.length === 0 || initialLoading) {
			searchRunning = false;
			return;
		}

		searchRunning = true;
		const isCurrent = () => generation === searchGeneration;
		const timer = setTimeout(() => {
			void runConversationSearch({
				index: conversations.searchIndex,
				query,
				getConversations: () => conversations.entries,
				hasMoreConversations: () => conversations.nextPage !== null,
				conversationPageToken: () => conversations.paging.armToken,
				loadMoreConversations: () => conversations.paging.runToIdle(),
				getPagingFailure: () => conversations.paging.failure,
				prime: (conversation) =>
					conversations.searchIndex.prime(
						conversation,
						conversations.getCachedConversation(
							conversation.data.conversationId,
						),
					),
				isCurrent,
				onProgress: () => {
					if (isCurrent()) searchCacheRevision += 1;
				},
			})
				.then(() => {
					if (!isCurrent()) return;
					searchCacheRevision += 1;
					searchRunning = false;
				})
				.catch((error: unknown) => {
					if (!isCurrent()) return;
					searchFailure =
						error instanceof Error
							? error
							: new Error(String(error));
					searchRunning = false;
				});
		}, SEARCH_DEBOUNCE_MS);

		return () => {
			clearTimeout(timer);
			if (searchGeneration === generation) searchGeneration += 1;
		};
	});

	function retrySearch() {
		if (conversations.paging.failure) conversations.paging.retry();
		searchRetryNonce += 1;
	}

	$effect(() => {
		conversations.noteListViewed();
	});

	let container: HTMLDivElement | null = $state(null);

	restoreScrollOnce(() => container, conversations);

	let { class: className }: { class?: import("svelte/elements").ClassValue } =
		$props();

	const selection = new SelectionSet<string>();
	let selecting = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteIds: string[] = $state([]);

	async function compensateScroll() {
		if (!container) return;
		const paddingBefore = parseFloat(
			getComputedStyle(container).paddingTop,
		);
		const scrollBefore = container.scrollTop;
		await tick();
		if (!container) return;
		const delta =
			parseFloat(getComputedStyle(container).paddingTop) - paddingBefore;
		if (delta !== 0) {
			container.scrollTop = Math.max(0, scrollBefore + delta);
		}
	}

	const selectedEntries = $derived(
		conversations.entries.filter((entry) =>
			selection.has(entry.data.conversationId),
		),
	);
	const allPinned = $derived(
		selectedEntries.length > 0 &&
			selectedEntries.every((entry) => entry.data.pinned),
	);
	const allMuted = $derived(
		selectedEntries.length > 0 &&
			selectedEntries.every((entry) => entry.data.muted),
	);

	function enterSelection(conversationId: string) {
		if (!selecting) {
			selecting = true;
			void compensateScroll();
		}
		selection.add(conversationId);
	}

	function exitSelection() {
		if (selecting) {
			selecting = false;
			void compensateScroll();
		}
		selection.clear();
	}

	$effect(() => {
		if (selecting && (!mobile.current || selection.size === 0)) {
			exitSelection();
		}
	});

	$effect(() => {
		if (!selecting) return;
		const known = new Set(
			conversations.entries.map((entry) => entry.data.conversationId),
		);
		for (const conversationId of selection.values()) {
			if (!known.has(conversationId)) selection.delete(conversationId);
		}
	});

	dismissOnBackGesture({ active: () => selecting, dismiss: exitSelection });
	dismissOnBackGesture({
		active: () => deleteDialogOpen,
		dismiss: () => {
			deleteDialogOpen = false;
		},
	});

	function pinSelected() {
		const conversationIds = selection.values();
		const pinned = !allPinned;
		exitSelection();
		void conversations.setPinned({ conversationIds, pinned });
	}

	function muteSelected() {
		const conversationIds = selection.values();
		const muted = !allMuted;
		exitSelection();
		void conversations.setMuted({ conversationIds, muted });
	}

	function requestDelete(conversationIds: string[]) {
		deleteIds = conversationIds;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		exitSelection();
		if (deleteIds.some((id) => id === page.params.conversationId)) {
			await goto("/chat");
		}
		const known = new Set(
			conversations.entries.map((entry) => entry.data.conversationId),
		);
		const conversationIds = deleteIds.filter((id) => known.has(id));
		if (conversationIds.length === 0) return;
		void conversations.deleteConversations(conversationIds);
	}
</script>

{#if selecting}
	<ConversationsSelectionBar
		count={selection.size}
		{allPinned}
		{allMuted}
		onPin={pinSelected}
		onMute={muteSelected}
		onDelete={() => requestDelete(selection.values())}
		onClose={exitSelection}
	/>
{/if}
<DeleteConversationsDialog
	bind:open={deleteDialogOpen}
	count={deleteIds.length}
	onConfirm={() => void confirmDelete()}
/>

<div class="flex h-full w-full min-w-list-rail flex-col">
	<div class="relative flex min-h-0 flex-1 flex-col">
		<div
			bind:this={container}
			data-slot="conversations-scroller"
			class={[
				"flex min-h-0 flex-1 flex-col gap-1 overflow-auto overscroll-contain px-4",
				{
					"pt-15": !selecting,
					"pt-(--selection-bar-height)": selecting,
				},
				className,
			]}
			onscroll={() => (conversations.scrollY = container?.scrollTop ?? 0)}
		>
			{#if conversations.loading}
				{#each Array(8)}
					<Skeleton class="h-24.5 w-full shrink-0" />
				{/each}
			{:else if conversations.error}
				<div class="flex flex-1">
					<ApiErrorDisplay
						error={conversations.error}
						onRetry={() => conversations.retry()}
						class="m-auto"
					/>
				</div>
			{:else}
				<div
					class="flex min-h-overscrollable shrink-0 flex-col gap-1 pb-nav-clear"
				>
					{#each visibleResults as result, i (result.conversation.data.conversationId)}
						{@const conversation = result.conversation}
						{@const conversationId =
							conversation.data.conversationId}
						{@const searchMatch: ConversationSearchMatch | null =
							searching ? result.match : null}
						{#if i < EAGER_COUNT}
							<Conversation
								{conversation}
								{searchMatch}
								selection={selecting ? selection : null}
								onEnterSelection={mobile.current
									? () => enterSelection(conversationId)
									: undefined}
								onRequestDelete={() =>
									requestDelete([conversationId])}
							/>
						{:else}
							<LazyConversation
								{conversation}
								{searchMatch}
								selection={selecting ? selection : null}
								onEnterSelection={mobile.current
									? () => enterSelection(conversationId)
									: undefined}
								onRequestDelete={() =>
									requestDelete([conversationId])}
							/>
						{/if}
					{/each}
					<ConversationsPagingTail
						paging={conversations.paging}
						hasMore={conversations.nextPage !== null}
						listEmpty={visibleResults.length === 0}
						filtered={conversations.filters.active.length > 0 ||
							searching}
						query={searchQuery}
						searchingHistory={searchRunning}
						{searchFailure}
						onSearchRetry={retrySearch}
					/>
				</div>
			{/if}
		</div>
		{#if !conversations.loading && !conversations.error}
			<DataRefreshControl
				{container}
				updating={conversations.refreshing}
				position="top"
				onrefresh={() => void conversations.refresh()}
			/>
		{/if}
		<ConversationsFilters
			filters={conversations.filters}
			onchange={(active) => conversations.setFilters(active)}
			bind:query={searchQuery}
			inert={selecting}
		/>
	</div>
</div>
