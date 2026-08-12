<script lang="ts">
	import { CameraIcon, VideoCameraIcon } from "phosphor-svelte";
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import {
		addCapturedPhotoToDrawer,
		uploadExpiringChatVideo,
	} from "$lib/api/messaging/chat-media";
	import { getExpiringVideoStatus } from "$lib/api/messaging/expiring-videos";
	import { sendExpiringVideoMessage } from "$lib/api/messaging/messages";
	import {
		type CapturedShortVideo,
		capturePhoto,
		captureShortVideo,
		deleteCapturedShortVideo,
		reportMediaWorkflowDiagnostic,
	} from "$lib/app-data/media-capture";
	import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
	import { cacheShortVideo } from "$lib/app-data/short-video-cache";
	import { Button } from "$lib/components/ui/button";
	import type { DrawerMedia } from "$lib/api/messaging/drawer";
	import { getConversationState } from "../../conversation-state.svelte";

	let {
		disabled,
		onPhotoAdded,
		onClose,
	}: {
		disabled: boolean;
		onPhotoAdded: (media: DrawerMedia) => void;
		onClose: () => void;
	} = $props();

	const conversation = $derived(getConversationState()());
	let capturingPhoto = $state(false);
	let capturingVideo = $state(false);
	let sendingVideo = $state(false);
	let pendingVideo = $state<CapturedShortVideo | null>(null);

	onDestroy(() => {
		if (pendingVideo) {
			void deleteCapturedShortVideo(pendingVideo.fileCacheKey).catch(
				(error) => {
					console.error("Abandoned short-video cleanup failed", error);
				},
			);
		}
	});

	async function takePhoto(): Promise<void> {
		if (disabled || capturingPhoto) return;
		capturingPhoto = true;
		reportMediaWorkflowDiagnostic("photo_capture", "started");
		try {
			const result = await capturePhoto();
			if (result.status === "cancelled") {
				reportMediaWorkflowDiagnostic("photo_capture", "cancelled");
				return;
			}
			const added = await addCapturedPhotoToDrawer(result);
			onPhotoAdded(added);
			reportMediaWorkflowDiagnostic("photo_capture", "drawer_saved");
			toast.success("Photo added to chat media");
		} catch (error) {
			console.error("Photo capture workflow failed", error);
			reportMediaWorkflowDiagnostic("photo_capture", "failed", "error");
			showErrorToast({ label: "Couldn't take photo", error });
		} finally {
			capturingPhoto = false;
		}
	}

	async function recordVideo(): Promise<void> {
		if (disabled || capturingVideo || pendingVideo !== null) return;
		capturingVideo = true;
		reportMediaWorkflowDiagnostic("short_video_capture", "availability_check");
		try {
			const status = await getExpiringVideoStatus();
			if (status.available < 1) {
				reportMediaWorkflowDiagnostic(
					"short_video_capture",
					"unavailable",
					"warning",
				);
				toast.info("Short video isn't available for this account right now");
				return;
			}
			const result = await captureShortVideo();
			if (result.status === "cancelled") {
				reportMediaWorkflowDiagnostic("short_video_capture", "cancelled");
				return;
			}
			pendingVideo = result;
			reportMediaWorkflowDiagnostic("short_video_capture", "review_ready");
		} catch (error) {
			console.error("Short video capture workflow failed", error);
			reportMediaWorkflowDiagnostic(
				"short_video_capture",
				"capture_failed",
				"error",
			);
			showErrorToast({ label: "Couldn't record short video", error });
		} finally {
			capturingVideo = false;
		}
	}

	async function sendVideo(maxViews: 1 | 2): Promise<void> {
		const capture = pendingVideo;
		const targetId = conversation.profile?.profileId;
		if (!capture || targetId === undefined || sendingVideo) return;
		sendingVideo = true;
		const looping = getDeveloperSettingsSnapshot().shortVideoLooping;
		reportMediaWorkflowDiagnostic("short_video_capture", "upload_started");
		try {
			const uploaded = await uploadExpiringChatVideo({
				dataBase64: capture.dataBase64,
				durationMs: capture.durationMs,
				looping,
			});
			await cacheShortVideo(uploaded.mediaId, capture.dataBase64).catch(
				(error) => {
					console.error("Sent short-video cache failed", error);
					reportMediaWorkflowDiagnostic(
						"short_video_capture",
						"cache_failed",
						"warning",
					);
				},
			);
			sendExpiringVideoMessage({
				toUserId: targetId,
				mediaId: uploaded.mediaId,
				looping,
				maxViews,
			});
			pendingVideo = null;
			void deleteCapturedShortVideo(capture.fileCacheKey).catch((error) => {
				console.error("Captured short-video cleanup failed", error);
				reportMediaWorkflowDiagnostic(
					"short_video_capture",
					"cleanup_failed",
					"warning",
				);
			});
			reportMediaWorkflowDiagnostic("short_video_capture", "send_requested");
			toast.success(
				maxViews === 1 ? "View-once video sent" : "Replay video sent",
			);
			onClose();
		} catch (error) {
			console.error("Short video send workflow failed", error);
			reportMediaWorkflowDiagnostic(
				"short_video_capture",
				"send_failed",
				"error",
			);
			showErrorToast({ label: "Couldn't send short video", error });
		} finally {
			sendingVideo = false;
		}
	}

	async function discardVideo(): Promise<void> {
		const capture = pendingVideo;
		pendingVideo = null;
		if (!capture) return;
		try {
			await deleteCapturedShortVideo(capture.fileCacheKey);
		} catch (error) {
			console.error("Discarded short-video cleanup failed", error);
			showErrorToast({ label: "Couldn't discard short video", error });
		}
	}
</script>

<div class="flex flex-wrap items-center gap-2 p-2">
	<Button
		variant="secondary"
		disabled={disabled || capturingPhoto}
		onclick={() => void takePhoto()}
	>
		<CameraIcon weight="fill" />
		{capturingPhoto ? "Adding photo…" : "Camera"}
	</Button>
	<Button
		variant="secondary"
		disabled={disabled || capturingVideo || pendingVideo !== null}
		onclick={() => void recordVideo()}
	>
		<VideoCameraIcon weight="fill" />
		{capturingVideo
			? "Opening camera…"
			: pendingVideo !== null
				? "Review video below"
				: "Short video"}
	</Button>
</div>

{#if pendingVideo !== null}
	<div class="mx-2 mb-2 rounded-xl border bg-card p-3">
		<p class="font-medium">
			Send {Math.ceil(pendingVideo.durationMs / 1_000)}s video
		</p>
		<p class="mb-3 text-sm text-muted-foreground">
			Choose how many times the recipient can open it.
		</p>
		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				disabled={sendingVideo}
				onclick={() => void sendVideo(1)}
			>
				View once
			</Button>
			<Button disabled={sendingVideo} onclick={() => void sendVideo(2)}>
				Allow replay
			</Button>
			<Button
				variant="ghost"
				disabled={sendingVideo}
				onclick={() => void discardVideo()}
			>
				Discard
			</Button>
		</div>
	</div>
{/if}
