<script lang="ts">
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";

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
		seenTimestamp = $bindable(),
	}: {
		seenTimestamp: number;
	} = $props();

	const conversationState = $derived(getConversationState()());

	const ALBUM_MESSAGE_TYPES = ["Album", "ExpiringAlbum", "ExpiringAlbumV2"];
	let highlightedMessageId: string | null = $state(null);
	let highlightTimer: ReturnType<typeof setTimeout> | null = null;
	let replySearchGeneration = 0;
	let replySearchInFlight = false;

	function findMessage(messageId: string): HTMLElement | null {
		return document.querySelector<HTMLElement>(
			`[data-message-id="${CSS.escape(messageId)}"]`,
		);
	}

	function highlightTarget(target: HTMLElement, messageId: string): void {
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		highlightedMessageId = messageId;
		if (highlightTimer !== null) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => {
			highlightedMessageId = null;
			highlightTimer = null;
		}, 1600);
	}

	function offerContinue(messageId: string): void {
		toast.info("Search paused before the end of the conversation", {
			action: {
				label: "Continue",
				onClick: () => void revealReplyTarget(messageId),
			},
		});
	}

	async function revealReplyTarget(messageId: string) {
		if (replySearchInFlight) return;
		replySearchInFlight = true;
		const generation = ++replySearchGeneration;
		const state = conversationState;
		const conversationId = state.conversationId;
		const seenCursors = new Set<string>();
		try {
			for (let page = 0; page < 5; page++) {
				const target = findMessage(messageId);
				if (target) {
					highlightTarget(target, messageId);
					return;
				}
				const cursor = state.pageKey;
				if (cursor === null) {
					toast.info("Original message is no longer available");
					return;
				}
				if (seenCursors.has(cursor)) {
					toast.info("Original message is no longer available");
					return;
				}
				seenCursors.add(cursor);
				const outcome = await state.loadMore();
				await new Promise(requestAnimationFrame);
				if (
					generation !== replySearchGeneration ||
					conversationState !== state ||
					conversationState.conversationId !== conversationId
				)
					return;
				if (outcome === "busy" || outcome === "error") {
					offerContinue(messageId);
					return;
				}
				if (outcome === "end" || state.pageKey === null) {
					const finalTarget = findMessage(messageId);
					if (finalTarget) highlightTarget(finalTarget, messageId);
					else toast.info("Original message is no longer available");
					return;
				}
				if (state.pageKey === cursor) {
					toast.info("Original message is no longer available");
					return;
				}
			}

			const target = findMessage(messageId);
			if (target) {
				highlightTarget(target, messageId);
				return;
			}
			if (state.pageKey === null) {
				toast.info("Original message is no longer available");
			} else {
				offerContinue(messageId);
			}
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
</script>

{#each messages.toReversed() as message (message.messageId)}
	{@const isOut = message.senderId === conversationState.ourProfileId}
	<Message
		{message}
		{isOut}
		indexInStack={message.indexInStack}
		stackLength={message.stackLength}
		dayStart={message.dayStart}
		status={message.status}
		ourProfileId={conversationState.ourProfileId}
		peerProfileId={conversationState.profile?.profileId ?? null}
		otherName={conversationState.profile?.name}
		highlighted={highlightedMessageId === message.messageId}
		onRetry={(message.status === "failed" || message.status === "handled") &&
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
		isRead={isOut && message.messageId === messages[0].messageId
			? conversationState.lastReadTimestamp === message.timestamp
			: null}
		onVisible={!isOut
			? () => {
					if (message.timestamp > seenTimestamp) {
						seenTimestamp = message.timestamp;
					}
					conversationState.reportRead(message);
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
{/each}
