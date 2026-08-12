<script lang="ts">
	import { listDirectMediaHistory } from "$lib/app-data/direct-media-cache";
	import { toSharedMediaEntry } from "$lib/app-data/direct-media-retention";
	import { getConversationMediaViewer } from "$lib/chat/conversation-media-viewer.svelte";
	import { conversationMediaDeckItems } from "$lib/chat/shared-media-collection";
	import type {
		ApiResponseMessage,
		ImageMessage,
	} from "$lib/model/messaging/messages";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		messageId,
		conversationMessages = [],
		accountProfileId = 0,
		conversationId = "",
		peerProfileId = null,
		receivedFromPeer = false,
	}: {
		message: ImageMessage["body"];
		messageId: string;
		conversationMessages?: ApiResponseMessage[];
		accountProfileId?: number;
		conversationId?: string;
		peerProfileId?: number | null;
		receivedFromPeer?: boolean;
	} = $props();

	const media = new MessageMediaState();
	const viewer = getConversationMediaViewer()();

	function buildDeck(retained: ReturnType<typeof toSharedMediaEntry>[] = []) {
		if (!receivedFromPeer || peerProfileId === null) return [];
		const resolvedUrls = Object.fromEntries(
			retained.flatMap((entry) =>
				entry.cacheAvailability === "cached" && entry.remoteUrl !== null
					? [[entry.messageId, entry.remoteUrl] as const]
					: [],
			),
		);
		return conversationMediaDeckItems({
			context: {
				accountProfileId,
				conversationId,
				peerProfileId,
			},
			active: conversationMessages,
			cached: [],
			retained,
			resolvedUrls,
		}).map(({ id, kind, url, width, height, poster, unavailableLabel }) => ({
			id,
			kind,
			url,
			width,
			height,
			poster,
			unavailableLabel,
		}));
	}

	function openImage(opener: HTMLButtonElement): void {
		const receivedDeck = buildDeck();
		viewer.open({
			items:
				receivedDeck.length > 0
					? receivedDeck
					: [
							{
								id: messageId,
								kind: "image",
								url: message.url,
								width: message.width ?? undefined,
								height: message.height ?? undefined,
							},
						],
			startId: messageId,
			messageId,
			opener,
		});
		if (receivedDeck.length > 0) void extendDeckFromLocalHistory();
	}

	async function extendDeckFromLocalHistory(): Promise<void> {
		if (peerProfileId === null) return;
		let cursor: string | null = null;
		const retained: ReturnType<typeof toSharedMediaEntry>[] = [];
		const seen = new Set<string>();
		for (let page = 0; page < 4; page += 1) {
			const response = await listDirectMediaHistory({
				accountProfileId,
				conversationId,
				peerProfileId,
				cursor,
				pageSize: 60,
			});
			for (const entry of response.items)
				retained.push(toSharedMediaEntry(entry));
			if (viewer.activeMessageId !== messageId) return;
			const next = buildDeck(retained);
			if (next.length > 0) viewer.updateItems(next);
			if (response.nextCursor === null || seen.has(response.nextCursor)) return;
			seen.add(response.nextCursor);
			cursor = response.nextCursor;
		}
	}
</script>

<div
	class={["relative", { "ms-3 w-2/5 max-w-60 min-w-35": !media.clone }]}
	bind:this={media.el}
>
	<button
		type="button"
		aria-label="Open image"
		class="item block w-full appearance-none border-0 bg-transparent p-0"
		onclick={(event) => openImage(event.currentTarget)}
	>
		<img
			src={message.url}
			alt=""
			loading="lazy"
			decoding="async"
			class={[
				"w-full rounded-lg bg-card-foreground/10 object-cover",
				media.cornerClass,
			]}
			style:aspect-ratio={message.width !== null && message.height !== null
				? `${message.width} / ${message.height}`
				: undefined}
			draggable="false"
		/>
	</button>
	{@render media.adornments?.()}
</div>
