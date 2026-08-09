<script lang="ts">
	import type { Message } from "$lib/model/messaging/messages";
	import { setMessageComposerContext } from "../message-composer-context.svelte";
	import ComposerVoiceMessageTrigger from "./ComposerVoiceMessageTrigger.svelte";

	let {
		sendMessage,
	}: {
		sendMessage: (message: Message) => void | Promise<void>;
	} = $props();

	setMessageComposerContext(() => ({
		accountProfileId: 1,
		disabled: false,
		sendMessage,
		setText: () => {},
	}));
</script>

<ComposerVoiceMessageTrigger />
