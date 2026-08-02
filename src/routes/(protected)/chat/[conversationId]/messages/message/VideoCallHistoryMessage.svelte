<script lang="ts">
	import { videoCallHistoryPresentation } from "$lib/video-call/history";
	import type { VideoCallMessage } from "$lib/model/messaging/messages";
	import RichMessageCard from "./RichMessageCard.svelte";

	let {
		message,
		outgoing,
	}: {
		message: VideoCallMessage["body"];
		outgoing: boolean;
	} = $props();

	const presentation = $derived(
		videoCallHistoryPresentation(message, { outgoing }),
	);
</script>

<RichMessageCard
	title={presentation.title}
	description={presentation.description}
/>
