<script lang="ts">
	import { PlayIcon, VideoIcon } from "phosphor-svelte";
	import { tick } from "svelte";

	import { getSingleMessage } from "$lib/api/messaging/messages";
	import { getCachedShortVideo } from "$lib/app-data/short-video-cache";
	import {
		type VideoMessage,
		videoMessageSchema,
	} from "$lib/model/messaging/messages";
	import type {
		SharedMediaEntry,
		SharedMediaMessageType,
	} from "$lib/chat/shared-media";
	import {
		resolveBoundedLegacyRemoteVideo,
		resolveLegacyShortVideo,
	} from "./legacy-video-source";
	import { activateMedia, releaseMedia } from "./media-playback";
	import { MessageMediaState } from "./message-media.svelte";
	import { StableExplicitViewOnceMediaSource } from "./view-once-media";

	let {
		message,
		conversationId,
		messageId,
		isOut,
		privateMedia = false,
		accountProfileId,
		peerProfileId,
		receivedFromPeer,
		sentAt,
		messageType,
	}: {
		message: VideoMessage["body"];
		conversationId: string;
		messageId: string;
		isOut: boolean;
		privateMedia?: boolean;
		accountProfileId: number;
		peerProfileId: number | null;
		receivedFromPeer: boolean;
		sentAt: number;
		messageType: SharedMediaMessageType;
	} = $props();

	const media = new MessageMediaState();
	let video: HTMLVideoElement | null = $state(null);
	let activated = $state(false);
	let source: string | null = $state(null);
	let refreshed = $state(false);
	let activating = $state(false);
	let unavailable = $state(false);
	const consumptive = $derived(message.maxViews !== null);
	const directEntry = $derived.by((): SharedMediaEntry | null =>
		message.mediaId === null || !receivedFromPeer || peerProfileId === null
			? null
			: {
					accountProfileId,
					conversationId,
					peerProfileId,
					messageId,
					mediaId: String(message.mediaId),
					kind: "video",
					messageType,
					sentAt,
					remoteAvailability:
						message.viewsRemaining === 0 ? "views_exhausted" : "available",
					cacheAvailability: "not_cached",
					cacheToken: null,
					consumptive: true,
					remoteUrl: message.url,
				},
	);
	const directSourceState = new StableExplicitViewOnceMediaSource();
	const directSource = $derived.by(() =>
		directSourceState.forEntry(directEntry),
	);
	$effect(() => {
		if (source === null && !consumptive && message.url === null) {
			unavailable = true;
		}
	});

	async function activate(): Promise<void> {
		if (unavailable || activating) return;
		activating = true;
		try {
			if (consumptive) {
				const legacySource =
					!isOut && directEntry && message.mediaId !== null
						? await resolveLegacyShortVideo(directEntry, message.mediaId)
						: null;
				if (legacySource !== null) {
					source = legacySource;
				} else if (!isOut && directSource) {
					source = await directSource.open(async () => {
						const authorizedBody = await authorizeRecipientView();
						if (authorizedBody?.url == null) return null;
						return {
							url: authorizedBody.url,
							contentType: authorizedBody.contentType ?? "video/*",
						};
					}, message.viewsRemaining !== 0);
				} else {
					source = await resolveConsumptiveSource(message);
				}
			} else {
				source ??= message.url;
			}
			if (source === null) {
				unavailable = true;
				return;
			}
			activated = true;
			await tick();
			if (video) {
				activateMedia(video);
				await video.play().catch((error) => {
					console.error("Video playback could not start", error);
					activated = false;
				});
			}
		} catch {
			console.error("Video authorization or cache lookup failed");
			unavailable = true;
		} finally {
			activating = false;
		}
	}

	async function authorizeRecipientView(): Promise<
		VideoMessage["body"] | null
	> {
		const response = await getSingleMessage({ conversationId, messageId });
		return response.message.type === "Video" ||
			response.message.type === "PrivateVideo"
			? response.message.body
			: null;
	}

	async function resolveConsumptiveSource(
		body: VideoMessage["body"],
	): Promise<string | null> {
		if (body.mediaId !== null) {
			const cached = await getCachedShortVideo(body.mediaId);
			if (cached.found) {
				return `data:${cached.contentType};base64,${cached.dataBase64}`;
			}
		}
		if (body.url === null) return null;
		if (body.mediaId === null) return body.url;
		return await resolveBoundedLegacyRemoteVideo(body.url, body.mediaId);
	}

	async function refreshSource(): Promise<void> {
		if (refreshed) {
			unavailable = true;
			return;
		}
		refreshed = true;
		try {
			const response = await getSingleMessage({ conversationId, messageId });
			const refreshedBody =
				response.message.type === "Video" ||
				response.message.type === "PrivateVideo"
					? response.message.body
					: response.message.type === "NonExpiringVideo"
						? videoMessageSchema.shape.body.safeParse(response.message.body)
								.data
						: undefined;
			if (!refreshedBody?.url) {
				unavailable = true;
				return;
			}
			source = refreshedBody.url;
			await tick();
		} catch {
			unavailable = true;
			return;
		}
		await video?.play().catch((error) => {
			console.error("Video playback could not start", error);
		});
	}

	$effect(() => {
		const element = video;
		if (!element) return;
		const pauseWhenHidden = () => {
			if (document.hidden) element.pause();
		};
		document.addEventListener("visibilitychange", pauseWhenHidden);
		return () => {
			element.pause();
			releaseMedia(element);
			document.removeEventListener("visibilitychange", pauseWhenHidden);
		};
	});
</script>

<div
	bind:this={media.el}
	class={[
		"relative aspect-3/4 w-2/5 max-w-60 min-w-35 overflow-hidden rounded-lg bg-card",
		media.cornerClass,
		{ "ms-3": !media.clone },
	]}
>
	{#if unavailable}
		<div
			class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground"
		>
			<VideoIcon class="size-8" />
			<span class="text-sm">Video unavailable</span>
		</div>
	{:else if !activated}
		<button
			type="button"
			class="flex size-full flex-col items-center justify-center gap-2 p-4 disabled:opacity-70"
			onclick={() => void activate()}
			disabled={media.clone || activating}
			aria-label={privateMedia ? "View private video" : "Play video"}
		>
			<span
				class="flex size-12 items-center justify-center rounded-full bg-black/60 text-white"
			>
				<PlayIcon weight="fill" />
			</span>
			<span class="text-sm text-muted-foreground">
				{message.viewsRemaining === 0
					? "View cached video"
					: privateMedia
						? "View private video"
						: "Play video"}
			</span>
			{#if message.viewsRemaining !== null && message.viewsRemaining !== undefined}
				<span class="text-xs text-muted-foreground"
					>{message.viewsRemaining}
					{message.viewsRemaining === 1 ? "view" : "views"} remaining</span
				>
			{/if}
		</button>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption (user-generated chat video has no caption track in the service contract) -->
		<video
			bind:this={video}
			src={source ?? undefined}
			controls={!consumptive}
			playsinline
			preload="none"
			class="size-full object-contain"
			onplay={() => video && activateMedia(video)}
			onerror={() => {
				if (consumptive) unavailable = true;
				else void refreshSource();
			}}
			onended={() => {
				if (consumptive) {
					activated = false;
					source = null;
				}
			}}
		></video>
	{/if}
	{@render media.adornments?.()}
</div>
