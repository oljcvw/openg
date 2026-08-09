<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import { expoOut } from "svelte/easing";
	import { scale } from "svelte/transition";

	import { isReceivedFromConversationPeer } from "$lib/chat/shared-media";
	import { videoMessageSchema } from "$lib/model/messaging/messages";
	import type { DisplayMessage } from "$lib/model/messaging/messages";
	import AlbumContentMessage from "./AlbumContentMessage.svelte";
	import AlbumMessage from "./AlbumMessage.svelte";
	import AudioMessage from "./AudioMessage.svelte";
	import { setMessageContext } from "./context";
	import ExpiringImageMessage from "./ExpiringImageMessage.svelte";
	import GiphyMessage from "./GiphyMessage.svelte";
	import ImageMessage from "./ImageMessage.svelte";
	import LocationMessage from "./LocationMessage.svelte";
	import MessageContextMenu from "./MessageContextMenu.svelte";
	import MessageDateGroup from "./MessageDateGroup.svelte";
	import MessageTime from "./MessageTime.svelte";
	import MessageWrapper from "./MessageWrapper.svelte";
	import Reaction from "./Reaction.svelte";
	import TextMessage from "./TextMessage.svelte";
	import UncommonMessage from "./UncommonMessage.svelte";
	import UnsentMessage from "./UnsentMessage.svelte";
	import UnsupportedMessage from "./UnsupportedMessage.svelte";
	import VideoCallHistoryMessage from "./VideoCallHistoryMessage.svelte";
	import VideoMessage from "./VideoMessage.svelte";

	let {
		message,
		isOut,
		isRead,
		indexInStack,
		stackLength,
		dayStart,
		status,
		onReact,
		onDelete,
		onVisible,
		onUnsend,
		onUnshareAlbum,
		onRetry,
		onMarkHandled,
		onSendAgain,
		onSavePhrase,
		onReply,
		onReplySelect,
		ourProfileId,
		peerProfileId,
		otherName,
		highlighted = false,
	}: {
		message: DisplayMessage;
		isOut: boolean;
		isRead: boolean | null;
		indexInStack: number;
		stackLength: number;
		dayStart?: number;
		status?:
			| "queued"
			| "awaitingAck"
			| "confirming"
			| "sent"
			| "failed"
			| "handled";
		onReact?: (reactionId: number) => void;
		onDelete?: () => void;
		onVisible?: () => void;
		onUnsend?: () => void;
		onUnshareAlbum?: () => void;
		onRetry?: () => void;
		onMarkHandled?: () => void;
		onSendAgain?: () => void;
		onSavePhrase?: () => void;
		onReply?: () => void;
		onReplySelect?: () => void;
		ourProfileId: number;
		peerProfileId: number | null;
		otherName?: string | null;
		highlighted?: boolean;
	} = $props();

	const firstInStack = $derived(indexInStack === 0);
	const lastInStack = $derived(indexInStack === stackLength - 1);
	const receivedFromPeer = $derived(
		isReceivedFromConversationPeer({
			accountProfileId: ourProfileId,
			peerProfileId,
			senderProfileId: message.senderId,
			isOut,
		}),
	);

	setMessageContext(() => ({
		firstInStack,
		lastInStack,
		indexInStack,
		isOut,
		timestamp: message.timestamp,
	}));

	let contextMenuOpen:
		| false
		| {
				x: number;
				y: number;
				width: number;
				height: number;
		  } = $state(false);
	let messageElement: HTMLElement | null = $state(null);
	let swipeStart: { x: number; y: number } | null = $state(null);
	let swipeOffset = $state(0);
	let swipeLocked = $state(false);
	let swipePointerId: number | null = null;
	let swipeCaptureElement: HTMLElement | null = null;

	function resetSwipe(releaseCapture = true): void {
		const pointerId = swipePointerId;
		const captureElement = swipeCaptureElement;
		swipeStart = null;
		swipeOffset = 0;
		swipeLocked = false;
		swipePointerId = null;
		swipeCaptureElement = null;
		if (
			releaseCapture &&
			pointerId !== null &&
			captureElement?.hasPointerCapture(pointerId)
		) {
			captureElement.releasePointerCapture(pointerId);
		}
	}

	onDestroy(() => resetSwipe());

	function setRef(el: HTMLElement | null) {
		messageElement = el ?? null;
	}
	let inheritedStyles = $state("");

	const INHERITED_PROPS = [
		"font-size",
		"font-family",
		"font-weight",
		"font-style",
		"font-variant",
		"font-stretch",
		"line-height",
		"letter-spacing",
		"word-spacing",
		"text-transform",
		"text-indent",
		"text-align",
		"text-decoration",
		"color",
		"direction",
		"white-space",
		"word-break",
		"overflow-wrap",
		"tab-size",
		"hyphens",
		"cursor",
		"border-collapse",
		"border-spacing",
		"list-style",
		"list-style-type",
		"quotes",
	];

	function onContextMenu() {
		if (!messageElement) return;
		const rect = messageElement.getBoundingClientRect();
		const computed = getComputedStyle(messageElement);
		inheritedStyles = INHERITED_PROPS.map(
			(prop) => `${prop}: ${computed.getPropertyValue(prop)}`,
		).join("; ");
		contextMenuOpen = {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
		};
		tick()
			.then(() => contextMenu?.showModal())
			.catch((error) => console.error(error));
	}

	let contextMenu: HTMLDialogElement | null = $state(null);

	function unsupportedType(): string {
		if (
			message.type === "Unknown" &&
			typeof message.body === "object" &&
			message.body !== null &&
			"sourceType" in message.body &&
			typeof message.body.sourceType === "string"
		) {
			return message.body.sourceType;
		}
		return message.type;
	}

	function observeRead(node: HTMLElement) {
		if (!onVisible) return {};
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					onVisible();
					observer.disconnect();
				}
			},
			{ threshold: 0 },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

{#snippet adornments()}
	<div
		class={[
			"absolute top-0 z-5 -translate-y-1/2",
			{
				"right-0 translate-x-1/2": !isOut,
				"left-0 -translate-x-1/2": isOut,
			},
		]}
	>
		{#if message.reactions.length > 0}
			{@const reactionMap = message.reactions.reduce(
				(m, r) => m.set(r.reactionType, (m.get(r.reactionType) ?? 0) + 1),
				new Map<number, number>(),
			)}
			<div
				class="mt-1 mr-1 flex items-center gap-0.5"
				transition:scale={{ duration: 150, easing: expoOut }}
			>
				{#each reactionMap.entries() as [type, count]}
					<Reaction type={Number(type)} {count} />
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet content(clone?: boolean)}
	<MessageWrapper
		{clone}
		{setRef}
		{adornments}
		replyToMessage={message.replyToMessage}
		{ourProfileId}
		{otherName}
		{onReplySelect}
	>
		{#if message.type === "Text"}
			<TextMessage message={message.body} />
		{:else if message.type === "Image"}
			<ImageMessage message={message.body} />
		{:else if message.type === "Audio"}
			<AudioMessage
				message={message.body}
				conversationId={message.conversationId}
				messageId={message.messageId}
			/>
		{:else if message.type === "Video" || message.type === "PrivateVideo"}
			<VideoMessage
				message={message.body}
				conversationId={message.conversationId}
				messageId={message.messageId}
				{isOut}
				privateMedia={message.type === "PrivateVideo" ||
					message.body.maxViews !== null}
				accountProfileId={ourProfileId}
				{peerProfileId}
				{receivedFromPeer}
				sentAt={message.timestamp}
				messageType={message.type}
			/>
		{:else if message.type === "NonExpiringVideo"}
			{@const video = videoMessageSchema.shape.body.safeParse(message.body)}
			{#if video.success}
				<VideoMessage
					message={video.data}
					conversationId={message.conversationId}
					messageId={message.messageId}
					{isOut}
					accountProfileId={ourProfileId}
					{peerProfileId}
					{receivedFromPeer}
					sentAt={message.timestamp}
					messageType="NonExpiringVideo"
				/>
			{:else}
				<UnsupportedMessage type="Video" />
			{/if}
		{:else if message.type === "Giphy"}
			<GiphyMessage message={message.body} />
		{:else if message.type === "Gaymoji" || message.type === "Generative" || message.type === "ProfileLink" || message.type === "ProfilePhotoReply"}
			<UncommonMessage type={message.type} body={message.body} />
		{:else if message.type === "VideoCall"}
			<VideoCallHistoryMessage message={message.body} outgoing={isOut} />
		{:else if message.type === "ExpiringImage"}
			<ExpiringImageMessage
				message={message.body}
				conversationId={message.conversationId}
				messageId={message.messageId}
				accountProfileId={ourProfileId}
				{peerProfileId}
				{receivedFromPeer}
				sentAt={message.timestamp}
			/>
		{:else if message.type === "Location"}
			<LocationMessage message={message.body} />
		{:else if message.type === "Album" || message.type === "ExpiringAlbum" || message.type === "ExpiringAlbumV2"}
			<AlbumMessage
				message={message.body}
				senderProfileId={message.senderId}
				{peerProfileId}
				{isOut}
			/>
		{:else if message.type === "AlbumContentReply" || message.type === "AlbumContentReaction"}
			<AlbumContentMessage message={message.body} />
		{:else if message.type === "Unsent" || message.type === "Retracted"}
			<UnsentMessage
				label={message.type === "Retracted"
					? "Message removed"
					: "Message unsent"}
			/>
		{:else}
			<UnsupportedMessage type={unsupportedType()} />
		{/if}
	</MessageWrapper>
{/snippet}

<div
	class={[
		"relative z-1 flex flex-col gap-0.5",
		{
			"mt-3": firstInStack,
		},
	]}
>
	{#if firstInStack && dayStart !== undefined}
		<MessageDateGroup {dayStart} />
	{/if}
	<div
		class={{
			"pe-3 *:float-start *:me-auto": !isOut,
			"ps-3 *:float-end *:ms-auto": isOut,
		}}
		role="button"
		tabindex="0"
		aria-label="Message"
		data-message-id={message.messageId}
		class:ring-2={highlighted}
		class:ring-primary={highlighted}
		style:transform={`translateX(${swipeOffset}px)`}
		style:transition={swipeStart ? "none" : "transform 180ms ease-out"}
		style:touch-action="pan-y"
		onpointerdown={(event) => {
			if (isOut || !onReply || event.button !== 0) return;
			if (
				(event.target as HTMLElement).closest(
					"button, a, input, textarea, audio, video",
				)
			)
				return;
			resetSwipe();
			const target = event.currentTarget as HTMLElement;
			target.setPointerCapture(event.pointerId);
			swipeCaptureElement = target;
			swipePointerId = event.pointerId;
			swipeStart = { x: event.clientX, y: event.clientY };
		}}
		onpointermove={(event) => {
			if (
				!swipeStart ||
				event.pointerId !== swipePointerId ||
				isOut ||
				!onReply
			)
				return;
			const dx = event.clientX - swipeStart.x;
			const dy = event.clientY - swipeStart.y;
			if (!swipeLocked && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			if (!swipeLocked && Math.abs(dy) > Math.abs(dx)) {
				resetSwipe();
				return;
			}
			swipeLocked = true;
			swipeOffset = Math.min(72, Math.max(0, dx));
		}}
		onpointerup={(event) => {
			if (event.pointerId !== swipePointerId) return;
			if (swipeOffset >= 48) onReply?.();
			resetSwipe();
		}}
		onpointercancel={(event) => {
			if (event.pointerId === swipePointerId) resetSwipe();
		}}
		onlostpointercapture={(event) => {
			if (event.pointerId === swipePointerId) resetSwipe(false);
		}}
		ondblclick={(event) => {
			const selection = window.getSelection();
			if (
				selection &&
				!selection.isCollapsed &&
				messageElement?.contains(selection.anchorNode)
			)
				return;
			if (!isOut && onReact) {
				event.preventDefault();
				onReact(1);
				selection?.removeAllRanges();
			}
		}}
		onkeydown={(event) => {
			if (event.key === "Enter" || event.key === " ") {
				if (event.key === " ") event.preventDefault();
				onContextMenu();
			}
		}}
		oncontextmenu={(event) => {
			event.preventDefault();
			onContextMenu();
		}}
		style:visibility={contextMenuOpen ? "hidden" : undefined}
		use:observeRead
	>
		{@render content()}
	</div>
	{#if lastInStack}
		<span
			class={[
				"mx-3 mt-0.5 text-xs text-muted-foreground",
				{ "text-right": isOut },
			]}
		>
			{#if status === "queued" || status === "awaitingAck"}
				Sending...
			{:else if status === "confirming"}
				Confirming delivery...
				{#if onSendAgain}
					<button
						class="ms-2 underline"
						onclick={() => {
							if (
								window.confirm(
									"The original message may already have been delivered. Send a duplicate anyway?",
								)
							)
								onSendAgain();
						}}>Send again</button
					>
				{/if}
			{:else if status === "failed"}
				<span class="text-destructive">Not sent</span>
				{#if onRetry}
					<button class="ms-2 underline" onclick={onRetry}>Retry</button>
				{/if}
				{#if onSendAgain}
					<button
						class="ms-2 underline"
						onclick={() => {
							if (
								window.confirm(
									"The original message may already have been delivered. Send a duplicate anyway?",
								)
							)
								onSendAgain();
						}}>Send again</button
					>
				{/if}
				<button class="ms-2 underline" onclick={onMarkHandled}
					>Mark handled</button
				>
			{:else if status === "handled"}
				<span class="text-muted-foreground">Not sent</span>
				{#if onRetry}
					<button class="ms-2 underline" onclick={onRetry}>Retry</button>
				{/if}
			{:else}
				{#if isRead !== null}
					{#if isRead}
						Read
					{:else}
						Sent
					{/if}
				{/if}
				<MessageTime />
			{/if}
		</span>
	{/if}
</div>

{#if contextMenuOpen}
	<MessageContextMenu
		{contextMenuOpen}
		{content}
		{isOut}
		selectable={message.type === "Text"}
		onClose={() => (contextMenuOpen = false)}
		style={inheritedStyles}
		textContent={message.type === "Text" ? message.body.text : undefined}
		reactionAvailable={message.reactions.length === 0 && !isOut}
		{onDelete}
		{onUnsend}
		{onUnshareAlbum}
		{onSavePhrase}
		{onReply}
	/>
{/if}

<style>
	@media (prefers-reduced-motion: reduce) {
		[role="button"] {
			transition: none !important;
		}
	}
</style>
