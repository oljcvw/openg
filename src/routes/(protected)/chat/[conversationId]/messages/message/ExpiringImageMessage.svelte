<script lang="ts">
	import "photoswipe/style.css";
	import { ImagesIcon } from "phosphor-svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { showErrorToast } from "$lib/api/error";
	import { getSingleMessage } from "$lib/api/messaging/messages";
	import {
		type ExpiringImageMessage,
		expiringImageMessageSchema,
	} from "$lib/model/messaging/messages";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import type { SharedMediaEntry } from "$lib/chat/shared-media";
	import LockedMedia from "./LockedMedia.svelte";
	import { MessageMediaState } from "./message-media.svelte";
	import { StableExplicitViewOnceMediaSource } from "./view-once-media";

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

	type LoadedImage = { url: string };

	type ImageState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "open"; image: LoadedImage };

	let imageState = $state<ImageState>({ status: "idle" });
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
	const sourceState = new StableExplicitViewOnceMediaSource();
	const source = $derived.by(() => sourceState.forEntry(entry));

	function openImage(): void {
		if (imageState.status !== "idle") return;
		imageState = { status: "loading" };
		void (async () => {
			try {
				const authorize = async () => {
					const { body: image } = await getSingleMessage({
						conversationId,
						messageId,
					}).then((res) => expiringImageMessageSchema.parse(res.message));
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
				if (url == null) {
					unavailable = true;
					imageState = { status: "idle" };
					return;
				}
				imageState = {
					status: "open",
					image: { url },
				};
			} catch (error) {
				console.error(error);
				showErrorToast({
					label: "Failed to load expiring image",
					error,
				});
				unavailable = true;
				imageState = { status: "idle" };
			}
		})();
	}

	$effect(() => {
		if (imageState.status !== "open") return;
		const { image } = imageState;
		let lightbox: PhotoSwipeLightbox | undefined;
		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				lightbox = new PhotoSwipeLightbox({
					showHideAnimationType: "fade",
					pswpModule: () => import("photoswipe"),
					mainClass: `pswp--buttons-visible`,
				});
				lightbox.addFilter("numItems", () => 1);
				lightbox.addFilter("itemData", () => {
					return { src: image.url, width: 0, height: 0 };
				});
				const onBackGesture = () => {
					lightbox?.pswp?.close();
					return false;
				};
				lightbox.on("beforeOpen", () => {
					backGestureEventHandlers.add(onBackGesture);
				});
				lightbox.on("close", () => {
					backGestureEventHandlers.delete(onBackGesture);
				});
				lightbox.on("closingAnimationEnd", () => {
					imageState = { status: "idle" };
				});
				lightbox.init();
				lightbox.loadAndOpen(0);
			})
			.catch((error) => {
				console.error(error);
				showErrorToast({
					label: "Failed to open expiring image",
					error,
				});
				imageState = { status: "idle" };
			});
		return () => lightbox?.destroy();
	});
</script>

{#if !unavailable}
	<button
		class={[
			"flex w-50 items-center gap-2 px-4 py-3 text-start font-medium",
			className,
			contentClass,
			"border border-border bg-input",
			{
				"cursor-pointer": imageState.status === "idle",
				"opacity-50": imageState.status === "loading",
			},
		]}
		onclick={openImage}
		disabled={imageState.status !== "idle"}
		bind:this={media.el}
	>
		<ImagesIcon size={24} weight="fill" />
		<span
			>{message.viewsRemaining === 0
				? "View cached image"
				: "View expiring image"}</span
		>
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

<style>
	:global(.pswp__img) {
		object-fit: contain;
	}
</style>
