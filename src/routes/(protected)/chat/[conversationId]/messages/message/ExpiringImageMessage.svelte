<script lang="ts">
	import { ImagesIcon } from "phosphor-svelte";

	import { showErrorToast } from "$lib/api/error";
	import { getSingleMessage } from "$lib/api/messaging/messages";
	import { getConversationMediaViewer } from "$lib/chat/conversation-media-viewer.svelte";
	import {
		type ExpiringImageMessage,
		expiringImageMessageSchema,
	} from "$lib/model/messaging/messages";
	import type { SharedMediaEntry } from "$lib/chat/shared-media";
	import LockedMedia from "./LockedMedia.svelte";
	import { MessageMediaState } from "./message-media.svelte";
	import { ExplicitViewOnceMediaSource } from "./view-once-media";

	let {
		conversationId,
		messageId,
		message,
		accountProfileId,
		peerProfileId,
		receivedFromPeer,
		sentAt,
	}: {
		conversationId: string;
		messageId: string;
		message: ExpiringImageMessage["body"];
		accountProfileId: number;
		peerProfileId: number | null;
		receivedFromPeer: boolean;
		sentAt: number;
	} = $props();

	const media = new MessageMediaState();
	const viewer = getConversationMediaViewer()();

	const className: import("svelte/elements").ClassValue = $derived([
		"relative",
		{
			"ms-3": !media.clone,
			"size-full": media.clone,
		},
	]);
	const contentClass: import("svelte/elements").ClassValue = $derived([
		"rounded-xl",
		media.cornerClass,
	]);

	let loading = $state(false);
	let unavailable = $state(false);
	const entry = $derived.by((): SharedMediaEntry | null =>
		receivedFromPeer && peerProfileId !== null
			? {
					accountProfileId,
					conversationId,
					peerProfileId,
					messageId,
					mediaId: String(message.mediaId),
					kind: "image",
					messageType: "ExpiringImage",
					sentAt,
					remoteAvailability:
						message.viewsRemaining === 0 ? "views_exhausted" : "available",
					cacheAvailability: "not_cached",
					cacheToken: null,
					consumptive: true,
					remoteUrl: null,
				}
			: null,
	);
	const source = $derived.by(() => {
		const current = entry;
		if (current === null) return null;
		const identity = JSON.stringify([
			current.accountProfileId,
			current.conversationId,
			current.peerProfileId,
			current.messageId,
			current.mediaId,
			current.kind,
			current.messageType,
		]);
		return viewer.retainResolver(
			`view-once:${identity}`,
			() => new ExplicitViewOnceMediaSource(current),
		);
	});

	function openImage(opener: HTMLButtonElement): void {
		if (loading) return;
		loading = true;
		void viewer
			.openExplicit({
				messageId,
				opener,
				resolve: async (signal) => {
					const authorize = async () => {
						const { body: image } = await getSingleMessage({
							conversationId,
							messageId,
						}).then((response) =>
							expiringImageMessageSchema.parse(response.message),
						);
						return image.url;
					};
					const url = source
						? await source.open(async () => {
								const authorizedUrl = await authorize();
								return authorizedUrl === null
									? null
									: { url: authorizedUrl, contentType: "image/*" };
							}, message.viewsRemaining !== 0)
						: await authorize();
					if (signal.aborted) throw new DOMException("Aborted", "AbortError");
					if (url === null) throw new Error("Expiring image unavailable");
					return {
						items: [{ id: messageId, kind: "image" as const, url }],
						startId: messageId,
						preload: [0, 0] as [number, number],
					};
				},
			})
			.catch((error) => {
				if (error instanceof DOMException && error.name === "AbortError")
					return;
				console.error(error);
				showErrorToast({ label: "Failed to load expiring image", error });
				unavailable = true;
			})
			.finally(() => (loading = false));
	}
</script>

{#if !unavailable}
	<button
		class={[
			"flex w-50 items-center gap-2 px-4 py-3 text-start font-medium",
			className,
			contentClass,
			"border border-border bg-input",
			{
				"cursor-pointer": !loading,
				"opacity-50": loading,
			},
		]}
		onclick={(event) => openImage(event.currentTarget)}
		disabled={loading}
		bind:this={media.el}
	>
		<ImagesIcon size={24} weight="fill" />
		<span>
			{message.viewsRemaining === 0
				? "View cached image"
				: "View expiring image"}
		</span>
		{@render media.adornments?.()}
	</button>
{:else}
	<div class={["h-12 w-50", className, contentClass]} bind:this={media.el}>
		<LockedMedia
			class={[media.cornerClass, "gap-2 font-medium text-neutral-600"]}
			size="sm"
		>
			Image unavailable
		</LockedMedia>
		{@render media.adornments?.()}
	</div>
{/if}
