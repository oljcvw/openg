<script lang="ts">
	import {
		ConversationMediaViewerState,
		setConversationMediaViewer,
	} from "$lib/chat/conversation-media-viewer.svelte";
	import type { ImageMessage as ImageMessageModel } from "$lib/model/messaging/messages";
	import type { ApiResponseMessage } from "$lib/model/messaging/messages";
	import { setMessageContext, setMessageMetaContext } from "./context";
	import ImageMessage from "./ImageMessage.svelte";

	let {
		message,
		messageId,
		viewer,
		conversationMessages = [],
		accountProfileId = 7,
		peerProfileId = 42,
		receivedFromPeer = false,
	}: {
		message: ImageMessageModel["body"];
		messageId: string;
		viewer: ConversationMediaViewerState;
		conversationMessages?: ApiResponseMessage[];
		accountProfileId?: number;
		peerProfileId?: number | null;
		receivedFromPeer?: boolean;
	} = $props();

	setConversationMediaViewer(() => viewer);
	setMessageContext(() => ({
		firstInStack: true,
		lastInStack: true,
		indexInStack: 0,
		isOut: false,
		timestamp: 1,
	}));
	setMessageMetaContext(() => ({ clone: false, setRef: () => {} }));
</script>

<ImageMessage
	{message}
	{messageId}
	{conversationMessages}
	{accountProfileId}
	{peerProfileId}
	{receivedFromPeer}
	conversationId="conversation-42"
/>
