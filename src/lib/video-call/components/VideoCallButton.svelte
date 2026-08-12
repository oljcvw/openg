<script lang="ts">
	import VideoCameraIcon from "phosphor-svelte/lib/VideoCamera";

	import { Button } from "$lib/components/ui/button";
	import { videoCallController } from "$lib/video-call/controller";

	let {
		peerProfileId,
		peerLabel = null,
	}: {
		peerProfileId: number;
		peerLabel?: string | null;
	} = $props();

	let busy = $state(videoCallController.snapshot.phase !== "idle");

	$effect(() =>
		videoCallController.subscribe((snapshot) => {
			busy = snapshot.phase !== "idle";
		}),
	);
</script>

<Button
	variant="ghost"
	size="icon-lg"
	class="me-3"
	disabled={busy}
	onclick={() =>
		void videoCallController.startOutgoing({ peerProfileId, peerLabel })}
	aria-label="Start video call"
	title="Start video call"
>
	<VideoCameraIcon size={24} />
</Button>
