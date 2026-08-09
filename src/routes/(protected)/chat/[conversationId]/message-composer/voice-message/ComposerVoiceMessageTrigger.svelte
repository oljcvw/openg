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
	import type { Message } from "$lib/model/messaging/messages";
	import { getMessageComposerContext } from "../message-composer-context.svelte";
	import PrimaryComposerButton from "../PrimaryComposerButton.svelte";

	const composer = $derived(getMessageComposerContext()());
	type VoiceMessage = Extract<Message, { type: "Audio" }>;

	function supportsVoiceRecording(): boolean {
		try {
			return platform() === "android";
		} catch {
			return false;
		}
	}

	const supported = supportsVoiceRecording();
	let recording = $state(false);
	let starting = $state(false);
	let canceling = $state(false);
	let sending = $state(false);
	let pressing = false;
	let pointerId: number | null = null;
	let elapsedMs = $state(0);
	let startedAt = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let maxDurationListener: { unregister(): Promise<void> } | null = null;
	let recordingErrorListener: { unregister(): Promise<void> } | null = null;
	let listenerGeneration = 0;
	let destroyed = false;

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

	async function sendRecording(
		result: ReadyVoiceRecording,
		preparedMessage: VoiceMessage | null = null,
	): Promise<void> {
		if (sending) return;
		sending = true;
		let message = preparedMessage;
		try {
			if (message === null) {
				const bytes = new Uint8Array(fromBase64(result.dataBase64));
				const uploaded = await uploadChatMedia(bytes, result.contentType, {
					length: result.durationMs,
					takenOnGrindr: false,
				});
				message = {
					type: "Audio",
					body: {
						mediaId: uploaded.mediaId,
						mediaHash: uploaded.mediaHash,
						url: uploaded.url,
						contentType: result.contentType,
						length: result.durationMs,
						expiresAt: Date.now() + 15 * 60 * 1000,
					},
				};
			}
			await composer.sendMessage(message);
		} catch {
			console.warn("Failed to send voice message");
			const retryMessage = message;
			toast.error("Failed to send voice message", {
				action: {
					label: "Retry",
					onClick: () => void sendRecording(result, retryMessage),
				},
			});
		} finally {
			sending = false;
		}
	}

	async function begin(event?: PointerEvent): Promise<void> {
		if (composer.disabled || sending || starting || recording || destroyed)
			return;
		starting = true;
		pressing = true;
		pointerId = event?.pointerId ?? null;
		if (event) {
			const button = event.currentTarget as HTMLButtonElement;
			button.setPointerCapture(event.pointerId);
		}
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
			if (!destroyed)
				showErrorToast({ label: "Failed to start voice recording", error });
		} finally {
			starting = false;
		}
	}

	function toggleFromKeyboard(event: KeyboardEvent): void {
		if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
		event.preventDefault();
		if (recording) void finish();
		else void begin();
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
		const generation = ++listenerGeneration;
		void onVoiceRecordingMaxDuration(() => {
			if (destroyed || generation !== listenerGeneration || !recording) return;
			resetRecordingState();
			void stopVoiceRecording()
				.then((result) => {
					if (result.status === "ready") return sendRecording(result);
				})
				.catch((error) =>
					showErrorToast({ label: "Failed to finish voice recording", error }),
				);
		}).then(async (listener) => {
			if (destroyed || generation !== listenerGeneration) {
				await listener.unregister();
				return;
			}
			maxDurationListener = listener;
		});
		void onVoiceRecordingError(() => {
			if (destroyed || generation !== listenerGeneration || !recording) return;
			resetRecordingState();
			toast.error("Voice recording stopped unexpectedly.");
		}).then(async (listener) => {
			if (destroyed || generation !== listenerGeneration) {
				await listener.unregister();
				return;
			}
			recordingErrorListener = listener;
		});
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
		destroyed = true;
		listenerGeneration += 1;
		void cancel();
		void maxDurationListener?.unregister();
		void recordingErrorListener?.unregister();
		maxDurationListener = null;
		recordingErrorListener = null;
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
		onkeydown={toggleFromKeyboard}
		class="z-30 touch-none ps-0"
		disabled={composer.disabled || sending || starting}
		role="switch"
		aria-checked={recording}
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
