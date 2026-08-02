<script lang="ts">
	import { platform } from "@tauri-apps/plugin-os";
	import { MicrophoneIcon, PaperPlaneTiltIcon, XIcon } from "phosphor-svelte";
	import { onDestroy, onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import { uploadChatMedia } from "$lib/api/messaging/chat-media";
	import {
		cancelVoiceRecording,
		getVoicePermissionStatus,
		onVoiceRecordingError,
		onVoiceRecordingMaxDuration,
		type ReadyVoiceRecording,
		requestVoicePermission,
		startVoiceRecording,
		stopVoiceRecording,
	} from "$lib/api/voice-recorder";
	import { fromBase64 } from "$lib/util/base64";
	import { getMessageComposerContext } from "../message-composer-context.svelte";
	import PrimaryComposerButton from "../PrimaryComposerButton.svelte";

	const composer = $derived(getMessageComposerContext()());
	const supported = platform() === "android";
	let recording = $state(false);
	let canceling = $state(false);
	let sending = $state(false);
	let pressing = false;
	let pointerId: number | null = null;
	let elapsedMs = $state(0);
	let startedAt = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let maxDurationListener: { unregister(): Promise<void> } | null = null;
	let recordingErrorListener: { unregister(): Promise<void> } | null = null;

	function stopTimer(): void {
		if (timer !== null) clearInterval(timer);
		timer = null;
	}

	function resetRecordingState(): void {
		stopTimer();
		recording = false;
		canceling = false;
		pressing = false;
		pointerId = null;
		elapsedMs = 0;
	}

	async function sendRecording(result: ReadyVoiceRecording): Promise<void> {
		if (sending) return;
		sending = true;
		try {
			const bytes = new Uint8Array(fromBase64(result.dataBase64));
			const uploaded = await uploadChatMedia(bytes, result.contentType, {
				length: result.durationMs,
				takenOnGrindr: false,
			});
			await composer.sendMessage({
				type: "Audio",
				body: {
					mediaId: uploaded.mediaId,
					mediaHash: uploaded.mediaHash,
					url: uploaded.url,
					contentType: result.contentType,
					length: result.durationMs,
					expiresAt: Date.now() + 15 * 60 * 1000,
				},
			});
		} catch (error) {
			console.error("Failed to send voice message", error);
			toast.error("Failed to send voice message", {
				action: {
					label: "Retry",
					onClick: () => void sendRecording(result),
				},
			});
		} finally {
			sending = false;
		}
	}

	async function begin(event: PointerEvent): Promise<void> {
		if (composer.disabled || sending || recording) return;
		pressing = true;
		pointerId = event.pointerId;
		const button = event.currentTarget as HTMLButtonElement;
		button.setPointerCapture(event.pointerId);
		try {
			const status = await getVoicePermissionStatus();
			if (status !== "granted") {
				const requested = await requestVoicePermission();
				pressing = false;
				pointerId = null;
				if (requested === "granted") {
					toast.info("Microphone ready. Hold again to record.");
				} else {
					toast.error("Microphone permission is required for voice messages.");
				}
				return;
			}
			await startVoiceRecording();
			if (!pressing) {
				await cancelVoiceRecording();
				return;
			}
			recording = true;
			startedAt = performance.now();
			elapsedMs = 0;
			timer = setInterval(() => {
				elapsedMs = Math.min(60_000, performance.now() - startedAt);
			}, 100);
		} catch (error) {
			resetRecordingState();
			showErrorToast({ label: "Failed to start voice recording", error });
		}
	}

	function move(event: PointerEvent): void {
		if (!recording || event.pointerId !== pointerId) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		canceling = !(
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom
		);
	}

	async function finish(event?: PointerEvent): Promise<void> {
		if (event && event.pointerId !== pointerId) return;
		pressing = false;
		if (!recording) return;
		const shouldCancel = canceling;
		resetRecordingState();
		try {
			if (shouldCancel) {
				await cancelVoiceRecording();
				return;
			}
			const result = await stopVoiceRecording();
			if (result.status === "tooShort") {
				toast.info("Hold for at least one second to send a voice message.");
				return;
			}
			await sendRecording(result);
		} catch (error) {
			showErrorToast({ label: "Failed to finish voice recording", error });
		}
	}

	async function cancel(): Promise<void> {
		pressing = false;
		if (!recording) return;
		resetRecordingState();
		await cancelVoiceRecording().catch(() => {});
	}

	onMount(() => {
		if (!supported) return;
		void onVoiceRecordingMaxDuration(() => {
			if (!recording) return;
			resetRecordingState();
			void stopVoiceRecording()
				.then((result) => {
					if (result.status === "ready") return sendRecording(result);
				})
				.catch((error) =>
					showErrorToast({ label: "Failed to finish voice recording", error }),
				);
		}).then((listener) => (maxDurationListener = listener));
		void onVoiceRecordingError(() => {
			if (!recording) return;
			resetRecordingState();
			toast.error("Voice recording stopped unexpectedly.");
		}).then((listener) => (recordingErrorListener = listener));
		const onBlur = () => void cancel();
		const onVisibility = () => {
			if (document.hidden) void cancel();
		};
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	});

	onDestroy(() => {
		void cancel();
		void maxDurationListener?.unregister();
		void recordingErrorListener?.unregister();
	});
</script>

{#if supported}
	{#if recording}
		<div
			class={[
				"absolute inset-0 z-20 flex items-center justify-between rounded-composer px-3 text-sm",
				canceling
					? "bg-destructive/15 text-destructive"
					: "bg-popover text-foreground",
			]}
		>
			<span class="flex items-center gap-2">
				{#if canceling}<XIcon />{:else}<span
						class="size-2 animate-pulse rounded-full bg-red-500"
					></span>{/if}
				{canceling
					? "Release to cancel"
					: "Release to send, drag out to cancel"}
			</span>
			<span>{Math.ceil(elapsedMs / 1000)}s</span>
		</div>
	{/if}
	<PrimaryComposerButton
		onpointerdown={(event) => void begin(event)}
		onpointermove={move}
		onpointerup={(event) => void finish(event)}
		onpointercancel={() => void cancel()}
		onlostpointercapture={() => {
			if (pressing) void cancel();
		}}
		onclick={(event) => event.preventDefault()}
		class="z-30 touch-none ps-0"
		disabled={composer.disabled || sending}
		aria-label={recording
			? "Recording voice message"
			: "Hold to record voice message"}
	>
		{#snippet icon({ ...props })}
			{#if sending}
				<PaperPlaneTiltIcon {...props} />
			{:else}
				<MicrophoneIcon weight="fill" {...props} />
			{/if}
		{/snippet}
	</PrimaryComposerButton>
{/if}
