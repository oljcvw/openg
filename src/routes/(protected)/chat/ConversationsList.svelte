<script lang="ts">
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { page } from "$app/state";
	import { MagnifyingGlassIcon } from "phosphor-svelte";
	import { onMount, tick, untrack } from "svelte";
	import { get } from "svelte/store";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import {
		getDeveloperSettingsSnapshot,
		getInboxRowDensitySnapshot,
		type InboxRowDensity,
		subscribePreferences,
	} from "$lib/app-data/preferences.svelte";
	import {
		type ConversationFilter,
		filterConversations,
		normalizeConversationSearchQuery,
	} from "$lib/chat/conversation-filter";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import InboxTabs from "$lib/components/shared/InboxTabs.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import Skeleton from "$lib/components/ui/skeleton/skeleton.svelte";
	import {
		activateAppRootRoute,
		registerRootActivationRefresh,
	} from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		restoreScrollAnchor,
		ScrollCaptureGate,
	} from "$lib/navigation/navigation-memory";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { observeBackgroundTask } from "$lib/platform/client-diagnostics";
	import { below } from "$lib/util/breakpoints.svelte";
	import { SelectionSet } from "$lib/util/selection.svelte";
	import type { ConversationsState } from "$lib/chat/conversations-state.svelte";
	import {
		conversationListVirtualizerOptions,
		fallbackConversationVirtualRows,
		inboxRowEstimatePx,
		resolveConversationRestoreTarget,
		shouldLoadMoreConversations,
	} from "./conversation-list-window";
	import Conversation from "./Conversation.svelte";
	import ConversationsSelectionBar from "./ConversationsSelectionBar.svelte";
	import DeleteConversationsDialog from "./DeleteConversationsDialog.svelte";
	import EmptyConversationsList from "./EmptyConversationsList.svelte";

	const conversations: ConversationsState = getConversations();
	const accountSession = getAccountSessionSnapshot();
	const mobile = below("split");

	const latestActivity = $derived(
		conversations.entries.reduce(
			(max, entry) => Math.max(max, entry.data.lastActivityTimestamp),
			0,
		),
	);
	$effect(() => {
		// Fixes effect_update_depth_exceeded
		void latestActivity;
		untrack(() => conversations.markInboxViewed());
	});
	let container: HTMLDivElement | null = $state(null);
	const captureGate = new ScrollCaptureGate();
	$effect(() =>
		registerRootActivationRefresh("/chat", () =>
			captureGate.suppressDuring(async () => {
				navigationMemory.clearSurfaceAnchor("inboxChats", accountSession);
				container?.scrollTo({ top: 0, behavior: "smooth" });
				await conversations.refresh();
			}),
		),
	);

	let restorePosition: ReturnType<
		typeof navigationMemory.getSurfaceScrollPosition
	> = $state(null);
	onMount(() => {
		observeBackgroundTask(
			conversations.initial.then(tick).then(() => {
				restorePosition = navigationMemory.getSurfaceScrollPosition(
					"inboxChats",
					accountSession,
				);
			}),
			{
				category: "background_task",
				component: "inbox",
				code: "initial_scroll_restore_failed",
			},
		);
	});

	let {
		class: className,
	}: {
		class?: import("svelte/elements").ClassValue;
	} = $props();

	const selection = new SelectionSet<string>();
	let selecting = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteIds: string[] = $state([]);
	let searchQuery = $state("");
	let searchDebounceMs = $state(
		getDeveloperSettingsSnapshot().conversationSearchDebounceMs,
	);
	let conversationFilter: ConversationFilter = $state("all");
	let rowDensity: InboxRowDensity = $state(getInboxRowDensitySnapshot());
	let scrollOffset = $state(0);
	let autoRequestedPage: number | null = null;
	const rowEstimate = $derived(inboxRowEstimatePx(rowDensity));
	const normalizedSearchQuery = $derived(
		normalizeConversationSearchQuery(searchQuery),
	);
	const loadedConversationVersions = $derived(
		conversations.entries
			.map(
				(entry) =>
					`${entry.data.conversationId}:${entry.data.lastActivityTimestamp}`,
			)
			.join("\u0000"),
	);
	const messageMatchIds = $derived(
		conversations.messageSearchQuery === normalizedSearchQuery
			? conversations.messageSearchMatchIds
			: [],
	);

	const filteredEntries = $derived(
		filterConversations(conversations.entries, {
			filter: conversationFilter,
			failedConversationIds: conversations.failedConversationIds,
			messageMatchIds,
			query: searchQuery,
		}),
	);
	const filteredConversationIds = $derived(
		filteredEntries.map((entry) => entry.data.conversationId),
	);
	const virtualizer = createVirtualizer<HTMLElement, HTMLElement>(
		conversationListVirtualizerOptions(
			[],
			() => container,
			undefined,
			getInboxRowDensitySnapshot(),
		),
	);
	$effect(() => {
		const ids = filteredConversationIds;
		const scrollElement = container;
		untrack(() => {
			get(virtualizer).setOptions(
				conversationListVirtualizerOptions(
					ids,
					() => scrollElement,
					undefined,
					rowDensity,
				),
			);
			get(virtualizer).measure();
		});
	});
	const renderedVirtualRows = $derived.by(() => {
		const measured = $virtualizer.getVirtualItems();
		if (measured.length > 0 || filteredConversationIds.length === 0)
			return measured;
		// The scroll element and cached Inbox data can become available in the
		// same frame on a direct route load. Keep the list usable during that
		// hand-off; measuring these seed rows wakes the real virtual range.
		return fallbackConversationVirtualRows({
			conversationIds: filteredConversationIds,
			scrollOffset,
			viewportHeight: container?.clientHeight ?? 800,
			rowEstimate,
		});
	});
	const virtualContentHeight = $derived(
		Math.max(
			$virtualizer.getTotalSize(),
			filteredConversationIds.length * rowEstimate,
		),
	);

	$effect(() => {
		const rows = renderedVirtualRows;
		const nextPage = conversations.nextPage;
		const canLoad =
			nextPage !== null &&
			normalizedSearchQuery === "" &&
			conversationFilter === "all" &&
			!conversations.loadingMore &&
			conversations.loadMoreError === null &&
			autoRequestedPage !== nextPage;
		if (
			canLoad &&
			shouldLoadMoreConversations(rows, filteredConversationIds.length)
		) {
			autoRequestedPage = nextPage;
			untrack(() => void conversations.loadMore());
		}
		if (nextPage === null) autoRequestedPage = null;
	});

	let restoredPosition: ReturnType<
		typeof navigationMemory.getSurfaceScrollPosition
	> = null;
	$effect(() => {
		const position = restorePosition;
		const ids = filteredConversationIds;
		const scrollElement = container;
		if (
			!position ||
			!scrollElement ||
			ids.length === 0 ||
			restoredPosition === position
		)
			return;
		restoredPosition = position;
		void captureGate.suppressDuring(async () => {
			const target = resolveConversationRestoreTarget(
				ids,
				position.anchor.itemKey,
				position.neighborhood,
			);
			if (target) {
				get(virtualizer).scrollToIndex(target.index, { align: "start" });
				await tick();
			}
			restoreScrollAnchor(
				scrollElement,
				position.anchor,
				undefined,
				undefined,
				position.neighborhood,
			);
		});
	});
	$effect(() => {
		if (
			conversationFilter === "failed" &&
			conversations.failedConversationIds.length === 0
		) {
			conversationFilter = "all";
		}
	});
	const filtering = $derived(
		searchQuery.trim() !== "" || conversationFilter !== "all",
	);

	$effect(() => {
		void loadedConversationVersions;
		conversations.cancelMessageSearch(searchQuery);
		if (normalizedSearchQuery === "") return;
		const timeout = setTimeout(() => {
			void conversations.searchLoadedMessages(searchQuery);
		}, searchDebounceMs);
		return () => clearTimeout(timeout);
	});

	onMount(() =>
		subscribePreferences(() => {
			searchDebounceMs =
				getDeveloperSettingsSnapshot().conversationSearchDebounceMs;
			rowDensity = getInboxRowDensitySnapshot();
		}),
	);

	async function compensateScroll() {
		if (!container) return;
		const paddingBefore = parseFloat(getComputedStyle(container).paddingTop);
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

	$effect(() => {
		if (!selecting && !deleteDialogOpen) return;
		const onBackGesture = () => {
			if (deleteDialogOpen) {
				deleteDialogOpen = false;
			} else {
				exitSelection();
			}
			return false;
		};
		backGestureEventHandlers.add(onBackGesture);
		return () => {
			backGestureEventHandlers.delete(onBackGesture);
		};
	});

	function pinSelected() {
		const conversationIds = selection.values();
		const pinned = !allPinned;
		exitSelection();
		void conversations.setPinned(conversationIds, pinned);
	}

	function muteSelected() {
		const conversationIds = selection.values();
		const muted = !allMuted;
		exitSelection();
		void conversations.setMuted(conversationIds, muted);
	}

	function requestDelete(conversationIds: string[]) {
		deleteIds = conversationIds;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		exitSelection();
		if (deleteIds.some((id) => id === page.params.conversationId)) {
			await activateAppRootRoute("/chat");
		}
		const known = new Set(
			conversations.entries.map((entry) => entry.data.conversationId),
		);
		const conversationIds = deleteIds.filter((id) => known.has(id));
		if (conversationIds.length === 0) return;
		void conversations.deleteConversations(conversationIds);
	}

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(es) => {
				if (es[0]?.isIntersecting)
					conversations.loadMore().catch((error) => console.error(error));
			},
			{ root: container, rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
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

<div class="relative flex h-full w-full min-w-list-rail flex-col">
	<div
		bind:this={container}
		class={[
			"flex min-h-0 flex-1 flex-col gap-1 overflow-auto overscroll-contain px-2 pb-0",
			selecting && "pt-(--selection-bar-height)",
			className,
		]}
		onscroll={() => {
			if (!container) return;
			scrollOffset = container.scrollTop;
			if (!captureGate.canCapture) return;
			const anchor = captureScrollAnchor(container);
			navigationMemory.setSurfaceAnchor(
				"inboxChats",
				anchor,
				accountSession,
				captureScrollNeighborhood(container, anchor.itemKey),
			);
		}}
	>
		{#if !selecting}
			<div
				class="sticky top-0 z-10 mb-2 flex shrink-0 flex-col gap-2 bg-background pt-2 pb-2 shadow-md"
			>
				<InboxTabs />
				<div class="relative">
					<MagnifyingGlassIcon
						aria-hidden="true"
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={searchQuery}
						type="search"
						aria-label="Search loaded chats by name or message text"
						placeholder="Search chats"
						class="pl-9"
					/>
				</div>
				<div class="flex gap-1" aria-label="Chat filters">
					{#each [["all", "All"], ["unread", "Unread"], ["favorites", "Favorites"], ...(conversations.failedConversationIds.length > 0 ? [["failed", "Failed"]] : [])] as option}
						<Button
							variant={conversationFilter === option[0] ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={conversationFilter === option[0]}
							onclick={() => {
								conversationFilter = option[0] as ConversationFilter;
							}}
						>
							{option[1]}
						</Button>
					{/each}
				</div>
				{#if normalizedSearchQuery !== "" && conversations.messageSearchStatus === "searching"}
					<p class="px-1 text-xs text-muted-foreground" aria-live="polite">
						Searching message history…
						{conversations.messageSearchScanned}/{conversations.messageSearchTotal}
						chats checked
					</p>
				{/if}
			</div>
		{/if}
		{#await conversations.initial}
			{#each Array(8)}
				<Skeleton
					class="w-full shrink-0"
					style={`min-block-size: ${rowEstimate}px`}
				/>
			{/each}
		{:then}
			<div class="min-h-overscrollable shrink-0 pb-nav-clear">
				{#if filteredEntries.length > 0}
					<div
						class="relative w-full"
						style:height={`${virtualContentHeight}px`}
					>
						{#each renderedVirtualRows as virtualRow (virtualRow.key)}
							{@const conversation = filteredEntries[virtualRow.index]}
							{#if conversation}
								{@const conversationId = conversation.data.conversationId}
								<div
									class="absolute top-0 left-0 w-full pb-1"
									data-index={virtualRow.index}
									data-navigation-item-key={conversationId}
									style:transform={`translateY(${virtualRow.start}px)`}
									use:$virtualizer.measureElement
								>
									<Conversation
										{conversation}
										{rowDensity}
										selection={selecting ? selection : null}
										onEnterSelection={mobile.current
											? () => enterSelection(conversationId)
											: undefined}
										onRequestDelete={() => requestDelete([conversationId])}
									/>
								</div>
							{/if}
						{/each}
					</div>
				{:else if filtering}
					<div
						class="flex min-h-48 flex-col items-center justify-center gap-1 px-4 text-center"
					>
						{#if normalizedSearchQuery !== "" && conversations.messageSearchStatus === "searching"}
							<p class="font-medium">Searching loaded chats…</p>
							<p class="text-sm text-muted-foreground">
								Checking messages already downloaded to this device.
							</p>
						{:else}
							<p class="font-medium">No matching chats</p>
							<p class="text-sm text-muted-foreground">
								Try another name, message, or filter. More results may appear as
								older messages are downloaded.
							</p>
						{/if}
					</div>
				{:else}
					<EmptyConversationsList />
				{/if}
				{#if conversations.loadingMore}
					{#each Array(6)}
						<Skeleton
							class="w-full shrink-0"
							style={`min-block-size: ${rowEstimate}px`}
						/>
					{/each}
				{/if}
				{#if conversations.loadMoreError !== null}
					<div class="flex min-h-28 items-center justify-center px-3">
						<ApiErrorDisplay
							error={conversations.loadMoreError}
							onRetry={() => {
								autoRequestedPage = conversations.nextPage;
								void conversations.retryLoadMore();
							}}
						/>
					</div>
				{/if}
				{#if conversations.nextPage !== null && normalizedSearchQuery === ""}
					<div class="h-px" use:observeSentinel></div>
				{/if}
			</div>
		{:catch error}
			<div class="flex flex-1">
				<ApiErrorDisplay
					{error}
					onRetry={() => conversations.retry()}
					class="m-auto"
				/>
			</div>
		{/await}
	</div>
	{#await conversations.initial then}
		<DataRefreshControl
			{container}
			updating={conversations.refreshing}
			position="top"
			hintOffset={12}
			onrefresh={() => void conversations.refresh()}
		/>
	{/await}
</div>
