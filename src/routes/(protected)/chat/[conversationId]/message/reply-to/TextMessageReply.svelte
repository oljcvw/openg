<script lang="ts">
	import type { ReplyPreview } from "$lib/model/messaging/messages";

	let { replyPreview }: { replyPreview: ReplyPreview } = $props();
</script>

<div>
	{replyPreview.text}
</div>
