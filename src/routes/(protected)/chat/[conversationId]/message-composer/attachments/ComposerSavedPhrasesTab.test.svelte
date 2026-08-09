<script lang="ts">
	import { setMessageComposerContext } from "../message-composer-context.svelte";
	import ComposerSavedPhrasesTab from "./ComposerSavedPhrasesTab.svelte";

	let { accountProfileId }: { accountProfileId: number } = $props();

	setMessageComposerContext(() => ({
		accountProfileId,
		disabled: false,
		sendMessage: () => {},
		setText: () => {},
	}));
</script>

<ComposerSavedPhrasesTab active onClose={() => {}} />
