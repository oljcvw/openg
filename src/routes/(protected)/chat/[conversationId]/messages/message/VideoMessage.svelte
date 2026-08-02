<script lang="ts">
	import { PlayIcon, VideoIcon } from "phosphor-svelte";
	import { tick } from "svelte";

	import { getSingleMessage } from "$lib/api/messaging/messages";
	import {
		cacheShortVideo,
		getCachedShortVideo,
	} from "$lib/app-data/short-video-cache";
	import {
		type VideoMessage,
		videoMessageSchema,
	} from "$lib/model/messaging/messages";
	import { toBase64 } from "$lib/util/base64";
	import { activateMedia, releaseMedia } from "./media-playback";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		conversationId,
		messageId,
		isOut,
		privateMedia = false,
	}: {
		message: VideoMessage["body"];
		conversationId: string;
		messageId: string;
		isOut: boolean;
		privateMedia?: boolean;
	} = $props();

	const media = new MessageMediaState();
	let video: HTMLVideoElement | null = $state(null);
	let activated = $state(false);
	let source: string | null = $state(null);
	let refreshed = $state(false);
	let unavailable = $state(false);
	const consumptive = $derived(message.maxViews !== null);
	$effect(() => {
		if (
			source === null &&
			(message.viewsRemaining === 0 || (!consumptive && message.url === null))
		) {
			unavailable = true;
		}
	});

	async function activate(): Promise<void> {
		if (unavailable) return;
		try {
			if (consumptive) {
				const authorizedBody = isOut ? message : await authorizeRecipientView();
				if (authorizedBody === null) {
					unavailable = true;
					return;
				}
				source = await resolveConsumptiveSource(authorizedBody);
			} else {
				source ??= message.url;
			}
		} catch (error) {
			console.error("Video authorization or cache lookup failed", error);
			unavailable = true;
			return;
		}
		if (source === null) {
			unavailable = true;
			return;
		}
		activated = true;
		await tick();
		if (video) {
			activateMedia(video);
			await video.play();
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
		try {
			const response = await fetch(body.url);
			if (!response.ok) return body.url;
			const bytes = new Uint8Array(await response.arrayBuffer());
			const dataBase64 = toBase64(bytes);
			await cacheShortVideo(body.mediaId, dataBase64);
			return `data:video/mp4;base64,${dataBase64}`;
		} catch (error) {
			console.error("Received short-video cache fill failed", error);
			return body.url;
		}
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
			await video?.play();
		} catch {
			unavailable = true;
		}
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
			disabled={media.clone}
			aria-label={privateMedia ? "View private video" : "Play video"}
		>
			<span
				class="flex size-12 items-center justify-center rounded-full bg-black/60 text-white"
			>
				<PlayIcon weight="fill" />
			</span>
			<span class="text-sm text-muted-foreground">
				{privateMedia ? "View private video" : "Play video"}
			</span>
			{#if message.viewsRemaining !== undefined}
				<span class="text-xs text-muted-foreground"
					>{message.viewsRemaining} views remaining</span
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
