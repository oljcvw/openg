<script lang="ts">
	import { PlayIcon, VideoIcon } from "phosphor-svelte";
	import { tick } from "svelte";

	import { getSingleMessage } from "$lib/api/messaging/messages";
	import {
		type VideoMessage,
		videoMessageSchema,
	} from "$lib/model/messaging/messages";
	import { activateMedia, releaseMedia } from "./media-playback";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		conversationId,
		messageId,
		privateMedia = false,
	}: {
		message: VideoMessage["body"];
		conversationId: string;
		messageId: string;
		privateMedia?: boolean;
	} = $props();

	const media = new MessageMediaState();
	let video: HTMLVideoElement | null = $state(null);
	let activated = $state(false);
	let source: string | null = $state(null);
	let refreshed = $state(false);
	let unavailable = $state(false);
	$effect(() => {
		if (
			source === null &&
			(message.url === null || message.viewsRemaining === 0)
		) {
			unavailable = true;
		}
	});

	async function activate(): Promise<void> {
		if (unavailable) return;
		activated = true;
		source ??= message.url;
		await tick();
		if (video) {
			activateMedia(video);
			await video.play();
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
		<video
			bind:this={video}
			src={source ?? undefined}
			controls
			playsinline
			preload="none"
			class="size-full object-contain"
			onplay={() => video && activateMedia(video)}
			onerror={() => void refreshSource()}
		></video>
	{/if}
	{@render media.adornments?.()}
</div>
