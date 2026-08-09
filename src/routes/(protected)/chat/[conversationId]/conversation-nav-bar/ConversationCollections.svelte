<script module lang="ts">
	export type CollectionOperationScope = {
		accountProfileId: number;
		conversationId: string;
		peerProfileId: number;
		generation: number;
	};

	export function collectionOperationOwnsCompletion(
		expected: CollectionOperationScope,
		current: CollectionOperationScope,
		token: number,
		owner: number | null,
	): boolean {
		return (
			token === owner &&
			expected.accountProfileId === current.accountProfileId &&
			expected.conversationId === current.conversationId &&
			expected.peerProfileId === current.peerProfileId &&
			expected.generation === current.generation
		);
	}
</script>

<script lang="ts">
	import { goto } from "$app/navigation";
	import {
		DotsThreeVerticalIcon,
		FolderOpenIcon,
		ImagesIcon,
		VideoCameraIcon,
	} from "phosphor-svelte";
	import { onDestroy, onMount, untrack } from "svelte";

	import {
		listDirectMediaHistory,
		upsertDirectMediaHistory,
	} from "$lib/app-data/direct-media-cache";
	import {
		setDirectMediaRetentionScope,
		toSharedMediaEntry,
	} from "$lib/app-data/direct-media-retention";
	import {
		getDeveloperSettingsSnapshot,
		getRetainSharedChatMediaSnapshot,
		subscribePreferences,
	} from "$lib/app-data/preferences.svelte";
	import {
		loadSharedAlbumCollection,
		loadSharedAlbumHistoryPage,
	} from "$lib/chat/shared-album-loader";
	import {
		classifyReceivedSharedMedia,
		galleryPlayableUrl,
		type SharedMediaEntry,
	} from "$lib/chat/shared-media";
	import { mergeSharedMediaSources } from "$lib/chat/shared-media-collection";
	import MixedMediaViewer from "$lib/components/media/MixedMediaViewer.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { videoCallController } from "$lib/video-call/controller";
	import type { SharedAlbum } from "$lib/model/messaging/albums";
	import type { ApiResponseMessage } from "$lib/model/messaging/messages";
	import { getConversationState } from "../conversation-state.svelte";
	import { getConversation } from "../messages";
	import SharedMediaTile from "./SharedMediaTile.svelte";

	const conversationState = $derived(getConversationState()());
	let {
		peerProfileId,
		peerLabel = null,
	}: {
		peerProfileId: number;
		peerLabel?: string | null;
	} = $props();
	let videoCallBusy = $state(videoCallController.snapshot.phase !== "idle");

	let albumsOpen = $state(false);
	let mediaOpen = $state(false);
	let currentAlbums = $state<SharedAlbum[]>([]);
	let cachedAlbums = $state<
		Awaited<ReturnType<typeof loadSharedAlbumHistoryPage>>["items"]
	>([]);
	let nextCachedCursor = $state<string | null>(null);
	let cachedCursorStack = $state<Array<string | null>>([null]);
	let albumLoading = $state(false);
	let albumError = $state<unknown>(null);
	let albumRefreshProvedEmpty = $state(false);
	let cachedAlbumPage = $state(0);
	let currentAlbumPage = $state(0);
	let loadGeneration = 0;
	let albumRefreshToken = 0;
	let albumRefreshOwner: number | null = null;
	let cachedPageToken = 0;
	let cachedPageOwner: number | null = null;
	let cachedPageLoading = $state(false);
	let cachedPageError = $state<unknown>(null);
	let cachedPageRetryDirection = $state<"newer" | "older">("older");
	let sharedAlbumRefreshSeconds = $state(
		getDeveloperSettingsSnapshot().sharedAlbumRefreshSeconds,
	);

	$effect(() =>
		videoCallController.subscribe((snapshot) => {
			videoCallBusy = snapshot.phase !== "idle";
		}),
	);
	let retainedMedia = $state<SharedMediaEntry[]>([]);
	let nextMediaCursor = $state<string | null>(null);
	let mediaLoading = $state(false);
	let retainedMediaError = $state<unknown>(null);
	let conversationMediaError = $state<unknown>(null);
	let mediaGeneration = 0;
	let retainedPageToken = 0;
	let retainedPageOwner: number | null = null;
	let conversationPageToken = 0;
	let conversationPageOwner: number | null = null;
	let mediaHistoryMessages = $state<ApiResponseMessage[]>([]);
	let mediaPageKey = $state<string | null>(null);
	let mediaHistoryLoading = $state(false);
	let seenMediaPageKeys = new Set<string>();
	let mediaWindowStart = $state(0);
	let selectedMediaId = $state<string | null>(null);
	let viewerSnapshot = $state<
		Array<{
			id: string;
			kind: "image" | "video";
			url: string | null;
			unavailableLabel: string;
		}>
	>([]);
	let resolvedMediaUrls = $state<Record<string, string | null>>({});
	let viewerOpener = $state<HTMLElement | null>(null);

	const showAlbums = $derived(
		currentAlbums.length > 0 ||
			cachedAlbums.length > 0 ||
			!albumRefreshProvedEmpty,
	);
	const sharedMedia = $derived.by(() => {
		if (peerProfileId === null) return [];
		const context = {
			accountProfileId: conversationState.ourProfileId,
			conversationId: conversationState.conversationId,
			peerProfileId,
		};
		return mergeSharedMediaSources({
			context,
			active: conversationState.messages,
			cached: mediaHistoryMessages,
			retained: retainedMedia,
		});
	});
	const visibleSharedMedia = $derived(
		sharedMedia.slice(mediaWindowStart, mediaWindowStart + 120),
	);
	const viewerItems = $derived(
		visibleSharedMedia.map((entry) => ({
			id: entry.messageId,
			kind: entry.kind,
			url: galleryPlayableUrl(
				entry,
				resolvedMediaUrls[entry.messageId] ?? null,
			),
			unavailableLabel:
				entry.cacheAvailability === "evicted"
					? "Cached copy no longer stored"
					: "Media unavailable",
		})),
	);
	const selectedMediaIndex = $derived(
		selectedMediaId === null
			? -1
			: viewerSnapshot.findIndex((item) => item.id === selectedMediaId),
	);
	const mediaError = $derived(conversationMediaError ?? retainedMediaError);

	function collectionScope(
		generation = mediaGeneration,
	): CollectionOperationScope {
		return {
			accountProfileId: conversationState.ourProfileId,
			conversationId: conversationState.conversationId,
			peerProfileId,
			generation,
		};
	}

	function operationOwns(
		scope: CollectionOperationScope,
		token: number,
		owner: number | null,
	): boolean {
		return collectionOperationOwnsCompletion(
			scope,
			collectionScope(),
			token,
			owner,
		);
	}

	async function loadMediaHistory(reset = false): Promise<void> {
		if (mediaLoading && !reset) return;
		const scope = collectionScope();
		const token = ++retainedPageToken;
		retainedPageOwner = token;
		mediaLoading = true;
		retainedMediaError = null;
		try {
			const page = await listDirectMediaHistory({
				accountProfileId: scope.accountProfileId,
				conversationId: scope.conversationId,
				peerProfileId: scope.peerProfileId,
				cursor: reset ? null : nextMediaCursor,
				pageSize: 60,
			});
			if (!operationOwns(scope, token, retainedPageOwner)) return;
			const additions = page.items.map(toSharedMediaEntry);
			retainedMedia = reset
				? additions
				: [...retainedMedia, ...additions].filter(
						(entry, index, values) =>
							values.findIndex(
								(candidate) => candidate.messageId === entry.messageId,
							) === index,
					);
			if (!reset && additions.length > 0) mediaWindowStart += 60;
			nextMediaCursor = page.nextCursor;
		} catch (error) {
			if (operationOwns(scope, token, retainedPageOwner))
				retainedMediaError = error;
		} finally {
			if (operationOwns(scope, token, retainedPageOwner)) {
				mediaLoading = false;
				retainedPageOwner = null;
			}
		}
	}

	async function loadOlderConversationMedia(): Promise<void> {
		const pageKey = mediaPageKey;
		if (
			pageKey === null ||
			mediaHistoryLoading ||
			seenMediaPageKeys.has(pageKey)
		)
			return;
		const scope = collectionScope();
		const token = ++conversationPageToken;
		conversationPageOwner = token;
		mediaHistoryLoading = true;
		conversationMediaError = null;
		seenMediaPageKeys.add(pageKey);
		try {
			// This intentionally bypasses ConversationState.loadMore: gallery
			// history must not advance read state or mutate the chat cache.
			const page = await getConversation({
				conversationId: scope.conversationId,
				pageKey,
			});
			if (!operationOwns(scope, token, conversationPageOwner)) return;
			const entries = page.messages
				.map((message) =>
					classifyReceivedSharedMedia(message, {
						accountProfileId: scope.accountProfileId,
						conversationId: scope.conversationId,
						peerProfileId: scope.peerProfileId,
					}),
				)
				.filter((entry): entry is SharedMediaEntry => entry !== null);
			await Promise.allSettled(
				entries.map((entry) =>
					upsertDirectMediaHistory({
						accountProfileId: entry.accountProfileId,
						conversationId: entry.conversationId,
						peerProfileId: entry.peerProfileId,
						messageId: entry.messageId,
						mediaId: entry.mediaId,
						kind: entry.kind,
						messageType: entry.messageType,
						sentAt: entry.sentAt,
						remoteAvailability: entry.remoteAvailability,
					}),
				),
			);
			if (!operationOwns(scope, token, conversationPageOwner)) return;
			mediaHistoryMessages = [...mediaHistoryMessages, ...page.messages];
			mediaPageKey =
				page.messages.length === 0 ||
				page.pageKey === null ||
				seenMediaPageKeys.has(page.pageKey)
					? null
					: page.pageKey;
			if (page.messages.length > 0) mediaWindowStart += 60;
		} catch (error) {
			if (operationOwns(scope, token, conversationPageOwner)) {
				conversationMediaError = error;
				seenMediaPageKeys.delete(pageKey);
			}
		} finally {
			if (operationOwns(scope, token, conversationPageOwner)) {
				mediaHistoryLoading = false;
				conversationPageOwner = null;
			}
		}
	}

	async function refreshAlbums(force = false): Promise<void> {
		if (albumLoading && !force) return;
		const scope = collectionScope();
		const generation = ++loadGeneration;
		const token = ++albumRefreshToken;
		albumRefreshOwner = token;
		albumLoading = true;
		albumError = null;
		try {
			const loaded = await loadSharedAlbumCollection({
				ownerProfileId: scope.peerProfileId,
			});
			if (
				!operationOwns(scope, token, albumRefreshOwner) ||
				generation !== loadGeneration ||
				albumRefreshOwner === null
			)
				return;
			currentAlbums = loaded.current;
			cachedAlbums = loaded.cached;
			nextCachedCursor = loaded.nextCachedCursor;
			cachedCursorStack = [null];
			cachedAlbumPage = 0;
			currentAlbumPage = 0;
			albumRefreshProvedEmpty =
				loaded.current.length === 0 && loaded.cached.length === 0;
		} catch (error) {
			if (
				!operationOwns(scope, token, albumRefreshOwner) ||
				generation !== loadGeneration ||
				albumRefreshOwner === null
			)
				return;
			albumError = error;
			// A failed refresh is not evidence that the collection is empty.
			albumRefreshProvedEmpty = false;
			try {
				const cached = await loadSharedAlbumHistoryPage({
					ownerProfileId: scope.peerProfileId,
					cursor: null,
				});
				if (
					!operationOwns(scope, token, albumRefreshOwner) ||
					generation !== loadGeneration ||
					albumRefreshOwner === null
				)
					return;
				cachedAlbums = cached.items;
				nextCachedCursor = cached.nextCursor;
			} catch {
				// Keep the last valid collection and preserve the original error.
			}
		} finally {
			if (
				operationOwns(scope, token, albumRefreshOwner) &&
				generation === loadGeneration &&
				albumRefreshOwner !== null
			) {
				albumLoading = false;
				albumRefreshOwner = null;
			}
		}
	}

	$effect(() => {
		const accountProfileId = conversationState.ourProfileId;
		const conversationId = conversationState.conversationId;
		const peer = peerProfileId;
		untrack(() => {
			mediaGeneration += 1;
			loadGeneration += 1;
			albumRefreshOwner = null;
			cachedPageOwner = null;
			retainedPageOwner = null;
			conversationPageOwner = null;
			albumLoading = false;
			cachedPageLoading = false;
			mediaLoading = false;
			mediaHistoryLoading = false;
			currentAlbums = [];
			cachedAlbums = [];
			cachedAlbumPage = 0;
			currentAlbumPage = 0;
			albumRefreshProvedEmpty = false;
			albumError = null;
			cachedPageError = null;
			retainedMediaError = null;
			conversationMediaError = null;
			retainedMedia = [];
			mediaHistoryMessages = [];
			mediaPageKey = untrack(() => conversationState.pageKey);
			seenMediaPageKeys = new Set();
			mediaWindowStart = 0;
			selectedMediaId = null;
			viewerSnapshot = [];
			resolvedMediaUrls = {};
			nextMediaCursor = null;
			setDirectMediaRetentionScope({
				accountProfileId,
				conversationId,
				peerProfileId: peer,
			});
			void refreshAlbums(true);
		});
	});

	$effect(() => {
		const open = mediaOpen;
		void conversationState.ourProfileId;
		void conversationState.conversationId;
		void peerProfileId;
		if (open) untrack(() => void loadMediaHistory(true));
	});

	$effect(() => {
		if (!getRetainSharedChatMediaSnapshot()) return;
		const context = {
			accountProfileId: conversationState.ourProfileId,
			conversationId: conversationState.conversationId,
			peerProfileId,
		};
		for (const message of conversationState.messages) {
			if (message.unsent) {
				const retained = retainedMedia.find(
					(entry) => entry.messageId === message.messageId,
				);
				if (retained) {
					void upsertDirectMediaHistory({
						accountProfileId: retained.accountProfileId,
						conversationId: retained.conversationId,
						peerProfileId: retained.peerProfileId,
						messageId: retained.messageId,
						mediaId: retained.mediaId,
						kind: retained.kind,
						messageType: retained.messageType,
						sentAt: retained.sentAt,
						remoteAvailability: "retracted",
					});
				}
				continue;
			}
			const entry = classifyReceivedSharedMedia(message, context);
			if (!entry) continue;
			void upsertDirectMediaHistory({
				accountProfileId: entry.accountProfileId,
				conversationId: entry.conversationId,
				peerProfileId: entry.peerProfileId,
				messageId: entry.messageId,
				mediaId: entry.mediaId,
				kind: entry.kind,
				messageType: entry.messageType,
				sentAt: entry.sentAt,
				remoteAvailability: entry.remoteAvailability,
			});
		}
	});

	$effect(() => {
		const open = albumsOpen;
		const seconds = sharedAlbumRefreshSeconds;
		void conversationState.ourProfileId;
		void conversationState.conversationId;
		void peerProfileId;
		if (!open) return;
		untrack(() => void refreshAlbums(true));
		const interval = window.setInterval(() => {
			if (document.visibilityState === "visible")
				untrack(() => void refreshAlbums());
		}, seconds * 1000);
		return () => window.clearInterval(interval);
	});

	onMount(() => {
		const unsubscribePreferences = subscribePreferences(() => {
			sharedAlbumRefreshSeconds =
				getDeveloperSettingsSnapshot().sharedAlbumRefreshSeconds;
		});
		const resume = () => {
			if (albumsOpen && document.visibilityState === "visible")
				untrack(() => void refreshAlbums(true));
		};
		document.addEventListener("visibilitychange", resume);
		return () => {
			unsubscribePreferences();
			document.removeEventListener("visibilitychange", resume);
		};
	});

	onDestroy(() => {
		mediaGeneration += 1;
		loadGeneration += 1;
		albumRefreshOwner = null;
		cachedPageOwner = null;
		retainedPageOwner = null;
		conversationPageOwner = null;
		setDirectMediaRetentionScope(null);
	});

	function albumCount(album: SharedAlbum): number | null {
		return album.contentCount
			? album.contentCount.imageCount + album.contentCount.videoCount
			: null;
	}

	function cachedAlbumStatus(album: (typeof cachedAlbums)[number]): string {
		const reason = album.membership.unavailableReason;
		if (
			reason === "expired" ||
			(album.access.status === "unavailable" &&
				album.access.reason === "expired")
		)
			return "Expired";
		if (
			reason === "views_exhausted" ||
			(album.access.status === "unavailable" &&
				album.access.reason === "views_exhausted")
		)
			return "View limit reached";
		if (reason === "deleted") return "Removed";
		if (reason === "unshared" || album.access.status === "unavailable")
			return "Unshared";
		if (album.retainedItems.some((item) => item.removedAt !== null))
			return "Removed content retained";
		if (
			album.retainedItems.length > 0 &&
			album.retainedItems.every((item) => item.cacheToken === null)
		)
			return "Cached copy no longer stored";
		return "Cached";
	}

	async function changeCachedPage(direction: "newer" | "older") {
		if (cachedPageLoading) return;
		const scope = collectionScope();
		const token = ++cachedPageToken;
		cachedPageOwner = token;
		cachedPageLoading = true;
		cachedPageError = null;
		cachedPageRetryDirection = direction;
		const nextIndex =
			direction === "older" ? cachedAlbumPage + 1 : cachedAlbumPage - 1;
		if (nextIndex < 0) {
			cachedPageLoading = false;
			cachedPageOwner = null;
			return;
		}
		const cursor =
			direction === "older"
				? nextCachedCursor
				: (cachedCursorStack[nextIndex] ?? null);
		if (direction === "older" && cursor === null) {
			cachedPageLoading = false;
			cachedPageOwner = null;
			return;
		}
		try {
			const page = await loadSharedAlbumHistoryPage({
				ownerProfileId: scope.peerProfileId,
				cursor,
			});
			if (!operationOwns(scope, token, cachedPageOwner)) return;
			cachedAlbums = page.items;
			nextCachedCursor = page.nextCursor;
			cachedAlbumPage = nextIndex;
			if (direction === "older") {
				cachedCursorStack = [...cachedCursorStack.slice(0, nextIndex), cursor];
			}
		} catch (error) {
			if (operationOwns(scope, token, cachedPageOwner)) cachedPageError = error;
		} finally {
			if (operationOwns(scope, token, cachedPageOwner)) {
				cachedPageLoading = false;
				cachedPageOwner = null;
			}
		}
	}

	async function openAlbum(albumId: number): Promise<void> {
		albumsOpen = false;
		await goto(`/albums/${albumId}?owner=${peerProfileId}`);
	}

	function openSharedMedia(
		entry: SharedMediaEntry,
		url: string,
		opener: HTMLButtonElement,
	): void {
		viewerOpener = opener;
		resolvedMediaUrls = { ...resolvedMediaUrls, [entry.messageId]: url };
		viewerSnapshot = viewerItems.map((item) =>
			item.id === entry.messageId ? { ...item, url } : item,
		);
		selectedMediaId = entry.messageId;
	}

	function closeSharedMedia(): void {
		selectedMediaId = null;
		viewerSnapshot = [];
	}

	function retryMediaError(): void {
		if (conversationMediaError !== null) void loadOlderConversationMedia();
		if (retainedMediaError !== null || conversationMediaError === null)
			void loadMediaHistory(retainedMedia.length === 0);
	}
</script>

{#if showAlbums}
	<Button
		variant="ghost"
		size="icon-lg"
		aria-label="View albums shared with me"
		title="View albums shared with me"
		onclick={() => (albumsOpen = true)}
	>
		<FolderOpenIcon class="size-6" />
	</Button>
{/if}

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-lg"
				aria-label="Conversation actions"
				title="Conversation actions"
			>
				<DotsThreeVerticalIcon class="size-6" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item
			class="min-chat-compact:hidden"
			disabled={videoCallBusy}
			onSelect={() =>
				void videoCallController.startOutgoing({ peerProfileId, peerLabel })}
		>
			<VideoCameraIcon class="size-5" />
			Start video call
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (mediaOpen = true)}>
			<ImagesIcon class="size-5" />
			Shared media
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<Drawer.Root bind:open={albumsOpen}>
	<Drawer.Content
		class="h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] max-h-none"
	>
		<Drawer.Header>
			<div class="flex items-center justify-between gap-3">
				<Drawer.Title>Albums shared with you</Drawer.Title>
				<Button
					variant="outline"
					size="sm"
					disabled={albumLoading}
					onclick={() => refreshAlbums()}
					>{albumLoading ? "Refreshing…" : "Refresh"}</Button
				>
			</div>
			<Drawer.Description
				>Current shares and retained album history.</Drawer.Description
			>
		</Drawer.Header>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
			{#if albumError !== null}
				<div
					class="mb-3 flex items-center justify-between gap-3 rounded-xl bg-muted p-3"
					role="status"
				>
					<span
						>Couldn’t refresh albums. Cached results are still available.</span
					>
					<Button variant="outline" size="sm" onclick={() => refreshAlbums()}
						>Retry</Button
					>
				</div>
			{/if}
			{#if albumLoading && currentAlbums.length === 0 && cachedAlbums.length === 0}
				<p class="py-8 text-center text-muted-foreground">Loading albums…</p>
			{:else if currentAlbums.length === 0 && cachedAlbums.length === 0}
				<p class="py-8 text-center text-muted-foreground">
					No shared albums are available.
				</p>
			{/if}
			{#if currentAlbums.length > 0}
				<h3 class="mb-2 text-base font-semibold">Shared now</h3>
				<div
					class="mb-6 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3"
				>
					{#each currentAlbums.slice(currentAlbumPage * 60, (currentAlbumPage + 1) * 60) as album (`${album.profileId}:${album.albumId}`)}
						<button
							class="overflow-hidden rounded-2xl border bg-card text-start"
							onclick={() => openAlbum(album.albumId)}
						>
							{#if album.content?.coverUrl}
								<img
									class="aspect-square w-full object-cover"
									src={album.content.coverUrl}
									alt=""
								/>
							{:else}
								<div
									class="flex aspect-square items-center justify-center bg-muted"
								>
									<FolderOpenIcon class="size-8" />
								</div>
							{/if}
							<div class="p-3">
								<div class="truncate font-medium">
									{album.albumName ?? "Untitled album"}
								</div>
								<div class="text-xs text-muted-foreground">
									{albumCount(album) ?? "Unknown"} items
								</div>
							</div>
						</button>
					{/each}
				</div>
				{#if currentAlbums.length > 60}
					<div class="mb-6 flex items-center justify-center gap-3">
						<Button
							variant="outline"
							disabled={currentAlbumPage === 0}
							onclick={() => (currentAlbumPage -= 1)}>Newer</Button
						>
						<span class="text-xs text-muted-foreground"
							>Page {currentAlbumPage + 1}</span
						>
						<Button
							variant="outline"
							disabled={(currentAlbumPage + 1) * 60 >= currentAlbums.length}
							onclick={() => (currentAlbumPage += 1)}>Older</Button
						>
					</div>
				{/if}
			{/if}
			{#if cachedAlbums.length > 0}
				<h3 class="mb-2 text-base font-semibold">Cached</h3>
				{#if cachedPageError !== null}
					<div
						class="mb-3 flex items-center justify-between gap-3 rounded-xl bg-muted p-3"
						role="status"
					>
						<span>Couldn’t load that cached-album page.</span>
						<Button
							variant="outline"
							size="sm"
							disabled={cachedPageLoading}
							onclick={() => changeCachedPage(cachedPageRetryDirection)}
							>Retry</Button
						>
					</div>
				{/if}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
					{#each cachedAlbums as album (`${album.ownerProfileId}:${album.albumId}`)}
						<button
							class="rounded-2xl border bg-card p-3 text-start"
							onclick={() => openAlbum(album.albumId)}
						>
							<div class="truncate font-medium">
								{album.album.albumName ?? "Untitled album"}
							</div>
							<div class="text-xs text-muted-foreground">
								{cachedAlbumStatus(album)} · {album.album.content.length} items
							</div>
						</button>
					{/each}
				</div>
				{#if cachedAlbumPage > 0 || nextCachedCursor !== null}
					<div class="mt-4 flex items-center justify-center gap-3">
						<Button
							variant="outline"
							disabled={cachedAlbumPage === 0 || cachedPageLoading}
							onclick={() => changeCachedPage("newer")}>Newer</Button
						>
						<span class="text-xs text-muted-foreground"
							>Page {cachedAlbumPage + 1}</span
						>
						<Button
							variant="outline"
							disabled={nextCachedCursor === null || cachedPageLoading}
							onclick={() => changeCachedPage("older")}>Older</Button
						>
					</div>
				{/if}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>

<Drawer.Root bind:open={mediaOpen}>
	<Drawer.Content
		class="h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] max-h-none"
	>
		<Drawer.Header>
			<Drawer.Title>Shared media</Drawer.Title>
			<Drawer.Description
				>Pictures and videos received in this chat.</Drawer.Description
			>
		</Drawer.Header>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
			{#if mediaError !== null}
				<div
					class="mb-3 flex items-center justify-between gap-3 rounded-xl bg-muted p-3"
					role="status"
				>
					<span
						>Couldn’t load older media. Existing results are still available.</span
					>
					<Button variant="outline" size="sm" onclick={retryMediaError}
						>Retry</Button
					>
				</div>
			{/if}
			{#if mediaLoading && sharedMedia.length === 0}
				<p class="py-8 text-center text-muted-foreground">
					Loading shared media…
				</p>
			{:else if sharedMedia.length === 0}
				<div
					class="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground"
				>
					<p>
						{mediaPageKey === null
							? "No received media found."
							: "No received media in the messages loaded so far."}
					</p>
					{#if mediaPageKey !== null}
						<Button
							variant="outline"
							disabled={mediaHistoryLoading}
							onclick={() => loadOlderConversationMedia()}
							>{mediaHistoryLoading
								? "Loading…"
								: "Search older messages"}</Button
						>
					{/if}
				</div>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1">
					{#each visibleSharedMedia as entry (entry.messageId)}
						<SharedMediaTile
							{entry}
							onResolved={(url) =>
								(resolvedMediaUrls = {
									...resolvedMediaUrls,
									[entry.messageId]: url,
								})}
							onOpen={(url, opener) => openSharedMedia(entry, url, opener)}
						/>
					{/each}
				</div>
				{#if mediaWindowStart > 0}
					<div class="flex justify-center py-4">
						<Button
							variant="outline"
							onclick={() =>
								(mediaWindowStart = Math.max(0, mediaWindowStart - 60))}
							>Newer media</Button
						>
					</div>
				{/if}
				{#if nextMediaCursor !== null}
					<div class="flex justify-center py-4">
						<Button
							variant="outline"
							disabled={mediaLoading}
							onclick={() => loadMediaHistory()}
							>{mediaLoading ? "Loading…" : "Load older cached media"}</Button
						>
					</div>
				{/if}
				{#if mediaPageKey !== null}
					<div class="flex justify-center py-4">
						<Button
							variant="outline"
							disabled={mediaHistoryLoading}
							onclick={() => loadOlderConversationMedia()}
							>{mediaHistoryLoading ? "Loading…" : "Load older media"}</Button
						>
					</div>
				{/if}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>

{#if selectedMediaIndex >= 0}
	<MixedMediaViewer
		items={viewerSnapshot}
		startIndex={selectedMediaIndex}
		opener={viewerOpener}
		onClose={closeSharedMedia}
	/>
{/if}
