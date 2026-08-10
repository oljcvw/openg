<script lang="ts">
	import { PauseIcon, PlayIcon } from "phosphor-svelte";
	import { tick } from "svelte";

	import { getSingleMessage } from "$lib/api/messaging/messages";
	import type { AudioMessage } from "$lib/model/messaging/messages";
	import { activateMedia, disposeMedia } from "./media-playback";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		conversationId,
		messageId,
	}: {
		message: AudioMessage["body"];
		conversationId: string;
		messageId: string;
	} = $props();

	const media = new MessageMediaState();
	let audio: HTMLAudioElement | null = $state(null);
	let source: string | null = $state(null);
	let playing = $state(false);
	let elapsed = $state(0);
	let measuredDuration = $state<number | null>(null);
	let refreshed = $state(false);
	let refreshing = $state(false);
	let unavailable = $state(false);
	const duration = $derived(measuredDuration ?? (message.length ?? 0) / 1000);

	function formatDuration(seconds: number): string {
		const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
		return `${Math.floor(safe / 60)}:${Math.floor(safe % 60)
			.toString()
			.padStart(2, "0")}`;
	}

	async function togglePlayback(): Promise<void> {
		if (unavailable) return;
		if (!audio) return;
		if (playing) {
			audio.pause();
			return;
		}
		source ??= message.url;
		if (!source) {
			await refreshSource();
			return;
		}
		await tick();
		activateMedia(audio);
		await audio.play().catch((error) => {
			console.error("Audio playback could not start", error);
		});
	}

	async function refreshSource(): Promise<void> {
		if (refreshing) return;
		if (refreshed) {
			unavailable = true;
			return;
		}
		refreshed = true;
		refreshing = true;
		try {
			const response = await getSingleMessage({ conversationId, messageId });
			if (
				response.message.type !== "Audio" ||
				response.message.body.url === null
			) {
				unavailable = true;
				return;
			}
			source = response.message.body.url;
			await tick();
		} catch {
			unavailable = true;
			return;
		} finally {
			refreshing = false;
		}
		if (audio) activateMedia(audio);
		await audio?.play().catch((error) => {
			console.error("Audio playback could not start", error);
		});
	}

	$effect(() => {
		const element = audio;
		if (!element) return;
		const pauseWhenHidden = () => {
			if (document.hidden) element.pause();
		};
		document.addEventListener("visibilitychange", pauseWhenHidden);
		return () => {
			disposeMedia(element);
			source = null;
			document.removeEventListener("visibilitychange", pauseWhenHidden);
		};
	});
</script>

<div
	bind:this={media.el}
	data-voice-note-interactive
	class={[
		"flex w-64 max-w-[80vw] items-center gap-2 rounded-xl bg-card p-2",
		media.cornerClass,
		{ "ms-3": !media.clone },
	]}
>
	<button
		type="button"
		class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
		disabled={unavailable || refreshing || media.clone}
		onclick={() => void togglePlayback()}
		aria-label={playing ? "Pause voice message" : "Play voice message"}
	>
		{#if playing}<PauseIcon weight="fill" />{:else}<PlayIcon
				weight="fill"
			/>{/if}
	</button>
	<div class="min-w-0 flex-1">
		<input
			type="range"
			min="0"
			max={Math.max(duration, 0.01)}
			step="0.1"
			value={elapsed}
			disabled={unavailable || duration <= 0}
			oninput={(event) => {
				if (audio) audio.currentTime = Number(event.currentTarget.value);
			}}
			aria-label="Voice message progress"
			class="w-full accent-primary"
		/>
		<div class="flex justify-between text-xs text-muted-foreground">
			<span>{unavailable ? "Unavailable" : formatDuration(elapsed)}</span>
			<span>{formatDuration(duration)}</span>
		</div>
	</div>
	<audio
		bind:this={audio}
		src={source ?? undefined}
		preload="none"
		onplay={() => {
			if (audio) activateMedia(audio);
			playing = true;
		}}
		onpause={() => (playing = false)}
		onended={() => {
			playing = false;
			elapsed = 0;
		}}
		onloadedmetadata={() => {
			if (audio && Number.isFinite(audio.duration))
				measuredDuration = audio.duration;
		}}
		ontimeupdate={() => {
			if (audio) elapsed = audio.currentTime;
		}}
		onerror={() => void refreshSource()}
	></audio>
	{@render media.adornments?.()}
</div>
