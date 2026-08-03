<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getKeepBottomNavigationBehindKeyboardSnapshot,
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getKeepBottomNavigationBehindKeyboardSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.keepBottomNavigationBehindKeyboard;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load keyboard-navigation preference", error);
			});
	});
</script>

<SwitchField
	title="Keep bottom navigation behind keyboard"
	description="When typing in chat, keep app navigation underneath the keyboard instead of moving it above."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ keepBottomNavigationBehindKeyboard: next }).catch(
				(error) => {
					value = previous;
					showErrorToast({
						label: "Failed to save keyboard-navigation preference",
						error,
					});
				},
			);
		}
	}
/>
