<script lang="ts">
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { onDestroy, tick, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { get } from "svelte/store";

	import { showErrorToast } from "$lib/api/error";
	import {
		getAlbumShared,
		setAlbumShared,
	} from "$lib/api/messaging/album-shares-state.svelte";
	import { unshareAlbum } from "$lib/api/messaging/albums";
	import {
		deleteMessageForMe,
		unsendMessage,
	} from "$lib/api/messaging/messages";
	import { getShowRetractedMessagesSnapshot } from "$lib/app-data/preferences.svelte";
	import {
		addSavedPhrase,
		DuplicateSavedPhraseError,
	} from "$lib/app-data/saved-phrases";
	import { canUnsendMessage } from "$lib/chat/message-actions";
	import {
		applyMessageRetractions,
		canReplyToMessage,
	} from "$lib/model/messaging/messages";
	import type { DisplayMessage } from "$lib/model/messaging/messages";
	import { getConversationState } from "../conversation-state.svelte";
	import { processMessages } from "../messages";
	import Message from "./message/Message.svelte";

	let {
		container,
		seenTimestamp = $bindable(),
		readReportingEnabled = true,
	}: {
		container: HTMLElement | null;
		seenTimestamp: number;
		readReportingEnabled?: boolean;
	} = $props();

	const conversationState = $derived(getConversationState()());

	const ALBUM_MESSAGE_TYPES = ["Album", "ExpiringAlbum", "ExpiringAlbumV2"];
	let highlightedMessageId: string | null = $state(null);
	let highlightTimer: ReturnType<typeof setTimeout> | null = null;
	let replySearchGeneration = 0;
	let replySearchInFlight = false;

	function highlightTarget(messageId: string): void {
		highlightedMessageId = messageId;
		if (highlightTimer !== null) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => {
			highlightedMessageId = null;
			highlightTimer = null;
		}, 1600);
	}

	export async function scrollToMessage(
		messageId: string,
		{
			align = "center",
			behavior = "auto",
			isCurrent = () => true,
			offsetPx = null,
		}: {
			align?: "start" | "center" | "end" | "auto";
			behavior?: ScrollBehavior;
			isCurrent?: () => boolean;
			offsetPx?: number | null;
		} = {},
	): Promise<boolean> {
		if (!isCurrent()) return false;
		const state = conversationState;
		const conversationId = state.conversationId;
		const located = await state.locateMessage(messageId);
		if (
			located === null ||
			!isCurrent() ||
			conversationState !== state ||
			conversationState.conversationId !== conversationId
		)
			return false;
		await tick();
		if (!isCurrent()) return false;
		const chronologicalIndex = chronologicalMessages.findIndex(
			(message) => message.messageId === messageId,
		);
		if (chronologicalIndex === -1) return false;
		$virtualizer.scrollToIndex(chronologicalIndex, { align, behavior });
		if (offsetPx !== null) {
			await tick();
			if (!isCurrent()) return false;
			const row = [
				...(container?.querySelectorAll<HTMLElement>("[data-message-id]") ??
					[]),
			].find((candidate) => candidate.dataset.messageId === messageId);
			if (row && container) {
				container.scrollTop +=
					row.getBoundingClientRect().top -
					container.getBoundingClientRect().top -
					offsetPx;
			}
		}
		return true;
	}

	export async function scrollToVoiceNote(messageId: string): Promise<boolean> {
		const found = await scrollToMessage(messageId, { align: "center" });
		if (!found || !container) return false;
		await tick();
		const row = [
			...container.querySelectorAll<HTMLElement>("[data-message-id]"),
		].find((candidate) => candidate.dataset.messageId === messageId);
		if (!row) return false;
		const viewport = container.getBoundingClientRect();
		const bounds = row.getBoundingClientRect();
		const topBand = viewport.top + viewport.height * 0.25;
		const bottomBand = viewport.top + viewport.height * 0.82;
		if (bounds.top <= topBand || bounds.bottom >= bottomBand) {
			const targetBottom = viewport.top + viewport.height * 0.78;
			container.scrollTop += bounds.bottom - targetBottom;
		}
		return true;
	}

	async function revealReplyTarget(messageId: string) {
		if (replySearchInFlight) return;
		replySearchInFlight = true;
		const generation = ++replySearchGeneration;
		const state = conversationState;
		const conversationId = state.conversationId;
		try {
			const found = await scrollToMessage(messageId, {
				align: "center",
				behavior: "smooth",
			});
			if (
				!found ||
				generation !== replySearchGeneration ||
				conversationState !== state ||
				conversationState.conversationId !== conversationId
			) {
				if (!found) toast.info("Original message is no longer available");
				return;
			}
			highlightTarget(messageId);
		} finally {
			if (generation === replySearchGeneration) replySearchInFlight = false;
		}
	}

	onDestroy(() => {
		replySearchGeneration += 1;
		if (highlightTimer !== null) clearTimeout(highlightTimer);
	});

	/**
	 * The album to offer unsharing for, or null when the message isn't an album
	 * we own. Keyed off ownerProfileId rather than who sent the message: a
	 * forwarded album is not ours to unshare.
	 */
	function albumIdToUnshare(message: DisplayMessage): number | null {
		if (!ALBUM_MESSAGE_TYPES.includes(message.type)) return null;
		const body = message.body as {
			albumId?: number;
			ownerProfileId?: number | null;
		};
		if (body.ownerProfileId !== conversationState.ourProfileId) return null;
		const albumId = body.albumId;
		if (albumId === undefined) return null;

		// The message is a snapshot from when it was sent and does not change when
		// the share is revoked, so drop the action once we know it is gone.
		// Unknown still offers it: the API tolerates unsharing what isn't shared,
		// and hiding it on a guess would strand a share that is still live.
		const profileId = conversationState.profile?.profileId;
		if (
			profileId !== undefined &&
			getAlbumShared(albumId, profileId) === false
		) {
			return null;
		}
		return albumId;
	}

	const messages = $derived(
		processMessages({
			messages: applyMessageRetractions(
				conversationState.messages,
				getShowRetractedMessagesSnapshot(),
			),
			ourProfileId: conversationState.ourProfileId,
		}),
	);
	const chronologicalMessages = $derived(messages.toReversed());
	const ESTIMATED_ROW_HEIGHT_PX = 96;
	const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
		count: 0,
		getScrollElement: () => container,
		estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
		measureElement: (element, entry) => {
			const borderBoxSize = entry?.borderBoxSize?.[0]?.blockSize;
			if (borderBoxSize !== undefined && borderBoxSize > 0)
				return borderBoxSize;
			const height = element.getBoundingClientRect().height;
			return height > 0 ? height : ESTIMATED_ROW_HEIGHT_PX;
		},
		getItemKey: (index) => chronologicalMessages[index]?.messageId ?? index,
		overscan: 8,
		anchorTo: "end",
		followOnAppend: true,
		scrollEndThreshold: 16,
		useAnimationFrameWithResizeObserver: true,
	});

	$effect(() => {
		const rows = chronologicalMessages;
		const scrollElement = container;
		untrack(() => {
			get(virtualizer).setOptions({
				count: rows.length,
				getScrollElement: () => scrollElement,
				getItemKey: (index) => rows[index]?.messageId ?? index,
			});
		});
	});

	let lastPaginationCursor: string | null = null;
	$effect(() => {
		const firstIndex = $virtualizer.getVirtualItems().at(0)?.index;
		const cursor = conversationState.pageKey;
		if (
			firstIndex === undefined ||
			firstIndex > 8 ||
			cursor === null ||
			conversationState.loadingMore ||
			lastPaginationCursor === cursor
		)
			return;
		lastPaginationCursor = cursor;
		void conversationState.loadMore().then((outcome) => {
			if (outcome === "busy" || outcome === "error") {
				lastPaginationCursor = null;
			}
		});
	});

	let lastNewerSegmentId: string | null = null;
	$effect(() => {
		const virtualItems = $virtualizer.getVirtualItems();
		const lastIndex = virtualItems.at(-1)?.index;
		const count = chronologicalMessages.length;
		const segmentId = conversationState.newerSegmentId;
		if (
			lastIndex === undefined ||
			lastIndex < count - 9 ||
			segmentId === null
		) {
			lastNewerSegmentId = null;
			return;
		}
		if (conversationState.loadingNewer || lastNewerSegmentId === segmentId)
			return;
		lastNewerSegmentId = segmentId;
		void conversationState.loadNewer().then((outcome) => {
			if (outcome === "busy") lastNewerSegmentId = null;
		});
	});
</script>

<div
	class="relative w-full shrink-0"
	style:height={`${$virtualizer.getTotalSize()}px`}
>
	{#each $virtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
		{@const message = chronologicalMessages[virtualRow.index]}
		{#if message}
			{@const isOut = message.senderId === conversationState.ourProfileId}
			<div
				class="absolute top-0 left-0 w-full"
				data-index={virtualRow.index}
				style:transform={`translateY(${virtualRow.start}px)`}
				use:$virtualizer.measureElement
			>
				<Message
					{message}
					conversationMessages={conversationState.messages}
					{isOut}
					indexInStack={message.indexInStack}
					stackLength={message.stackLength}
					dayStart={message.dayStart}
					status={message.status}
					ourProfileId={conversationState.ourProfileId}
					peerProfileId={conversationState.profile?.profileId ?? null}
					otherName={conversationState.profile?.name}
					highlighted={highlightedMessageId === message.messageId ||
						(conversationState.voiceNotes.active &&
							conversationState.voiceNotes.selectedKey === message.messageId)}
					visibilityEnabled={readReportingEnabled}
					onRetry={(message.status === "failed" ||
						message.status === "handled") &&
					(message.retryCount ?? 0) < 1
						? () => conversationState.retryFailedMessage(message.messageId)
						: undefined}
					onMarkHandled={() =>
						conversationState.markFailedMessageHandled(message.messageId)}
					onSendAgain={message.status === "confirming" ||
					((message.status === "failed" || message.status === "handled") &&
						(message.retryCount ?? 0) >= 1)
						? () => conversationState.sendAgain(message.messageId)
						: undefined}
					isRead={isOut && message.messageId === messages[0]?.messageId
						? conversationState.lastReadTimestamp === message.timestamp
						: null}
					onVisible={!isOut
						? () => {
								if (message.timestamp > seenTimestamp) {
									seenTimestamp = message.timestamp;
								}
								conversationState.reportIncomingVisible(message);
							}
						: undefined}
					onDelete={async () => {
						let revert: (() => void) | undefined;
						try {
							({ revert } = conversationState.remove(message.messageId));
							await deleteMessageForMe({
								conversationId: conversationState.conversationId,
								messageId: message.messageId,
							});
						} catch (error) {
							console.error(error);
							showErrorToast({
								label: "Failed to delete message",
								error,
							});
							revert?.();
						}
					}}
					onReact={async (reactionType: number) => {
						try {
							await conversationState.reactTo(message.messageId, reactionType);
						} catch (error) {
							console.error(error);
							showErrorToast({
								label: "Failed to react to message",
								error,
							});
						}
					}}
					onUnsend={canUnsendMessage(message, isOut)
						? async () => {
								let revert: (() => void) | undefined;
								try {
									({ revert } = conversationState.markMessageAsUnsent(
										message.messageId,
									));
									await unsendMessage({
										conversationId: conversationState.conversationId,
										messageId: message.messageId,
									});
								} catch (error) {
									console.error(error);
									showErrorToast({
										label: "Failed to unsend message",
										error,
									});
									revert?.();
								}
							}
						: undefined}
					onUnshareAlbum={albumIdToUnshare(message) !== null
						? async () => {
								const albumId = albumIdToUnshare(message);
								const profileId = conversationState.profile?.profileId;
								if (albumId === null || profileId === undefined) return;
								try {
									await unshareAlbum({ albumId, profileIds: [profileId] });
									setAlbumShared(albumId, profileId, false);
									toast.success("Album unshared");
								} catch (error) {
									console.error(error);
									showErrorToast({
										label: "Failed to unshare album",
										error,
									});
								}
							}
						: undefined}
					onSavePhrase={message.type === "Text" && !message.unsent
						? async () => {
								try {
									await addSavedPhrase(
										conversationState.ourProfileId,
										message.body.text,
									);
									toast.success("Phrase saved");
								} catch (error) {
									if (error instanceof DuplicateSavedPhraseError) {
										toast.info(error.message);
									} else {
										showErrorToast({ label: "Failed to save phrase", error });
									}
								}
							}
						: undefined}
					onReply={message.status === "sent" && canReplyToMessage(message)
						? () => conversationState.setReplyTarget(message)
						: undefined}
					onReplySelect={message.replyToMessage
						? () => void revealReplyTarget(message.replyToMessage!.messageId)
						: undefined}
				/>
			</div>
		{/if}
	{/each}
</div>
