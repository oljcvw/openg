<script lang="ts">
	import { onDestroy, untrack } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import {
		ConversationMediaViewerState,
		setConversationMediaViewer,
	} from "$lib/chat/conversation-media-viewer.svelte";
	import { getConversations } from "$lib/chat/conversations-context.svelte";
	import MixedMediaViewer from "$lib/components/media/MixedMediaViewer.svelte";
	import * as Card from "$lib/components/ui/card";
	import type { Message } from "$lib/model/messaging/messages";
	import {
		assertCurrentConversationDetailIdentity,
		type ConversationDetailIdentity,
	} from "./conversation-detail-identity";
	import ChatNavBar from "./conversation-nav-bar/ConversationNavBar.svelte";
	import {
		ConversationState,
		setConversationState,
	} from "./conversation-state.svelte";
	import MessageComposer from "./message-composer/MessageComposer.svelte";
	import ConversationMessages from "./messages/ConversationMessages.svelte";

	let { identity }: { identity: ConversationDetailIdentity } = $props();
	const detailIdentity = untrack(() => identity);
	assertCurrentConversationDetailIdentity(
		detailIdentity,
		getAccountSessionSnapshot(),
	);
	const conversationId = detailIdentity.conversationId;
	const ourProfileId = detailIdentity.accountProfileId;

	const conversations = getConversations();
	const conversationState = untrack(
		() =>
			new ConversationState({
				conversationId,
				ourProfileId,
				conversations,
			}),
	);
	setConversationState(() => conversationState);

	let viewerPinnedState: ConversationState | null = null;
	const mediaViewer = new ConversationMediaViewerState({
		pin: (messageId) => {
			viewerPinnedState = conversationState;
			void viewerPinnedState.pinMessage(messageId, "viewer");
		},
		unpin: (messageId) => {
			viewerPinnedState?.unpinMessage(messageId, "viewer");
			viewerPinnedState = null;
		},
	});
	setConversationMediaViewer(() => mediaViewer);

	onDestroy(() => {
		mediaViewer.clearConversation();
		conversationState.destroy();
	});

	let composerHeight = $state(0);
</script>

<ChatNavBar />
<Card.Content class="relative flex min-h-0 flex-1 flex-col p-0">
	<ConversationMessages {composerHeight} />
	<MessageComposer
		onSend={(message: Message) => conversationState.send(message)}
		disabled={conversationState.loading || conversationState.error !== null}
		accountProfileId={conversationState.ourProfileId}
		{conversationId}
		accountSession={conversationState.accountSession}
		replyTarget={conversationState.replyTarget}
		otherName={conversationState.profile?.name}
		onCancelReply={() => conversationState.clearReplyTarget()}
		bind:height={composerHeight}
	/>
</Card.Content>
{#if mediaViewer.ready}
	<MixedMediaViewer
		items={mediaViewer.items}
		startIndex={mediaViewer.startIndex}
		opener={mediaViewer.opener}
		preload={mediaViewer.preload}
		statusLabel={mediaViewer.statusLabel}
		diagnostics={mediaViewer.diagnostics}
		onItemActivate={mediaViewer.onItemActivate}
		onOpening={() => mediaViewer.markOpening()}
		onOpened={() => mediaViewer.markOpened()}
		onClose={() => mediaViewer.close()}
	/>
{/if}
