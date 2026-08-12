<script lang="ts">
	import type { ConversationState } from "../../conversation-state.svelte";
	import { setConversationState } from "../../conversation-state.svelte";
	import ComposerCaptureActions from "./ComposerCaptureActions.svelte";

	setConversationState(
		() => ({ profile: { profileId: 2 } }) as unknown as ConversationState,
	);
</script>

<ComposerCaptureActions
	disabled={false}
	onPhotoAdded={() => {}}
	onClose={() => {}}
/>
