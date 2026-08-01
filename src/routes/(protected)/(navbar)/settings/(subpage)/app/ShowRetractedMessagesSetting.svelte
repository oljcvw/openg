<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPreferences,
		getShowRetractedMessagesSnapshot,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getShowRetractedMessagesSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.showRetractedMessages;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load retracted-message preference", error);
			});
	});
</script>

<SwitchField
	title="Show retracted messages"
	description="Keep retracted messages visible in chat history and include their text in search when Open Grind still has the original message."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ showRetractedMessages: next }).catch((error) => {
				value = previous;
				showErrorToast({
					label: "Failed to save retracted-message preference",
					error,
				});
			});
		}
	}
/>
