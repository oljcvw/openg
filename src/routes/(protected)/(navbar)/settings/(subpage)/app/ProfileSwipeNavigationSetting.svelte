<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPreferences,
		getProfileSwipeNavigationSnapshot,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getProfileSwipeNavigationSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.profileSwipeNavigation;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load profile swipe preference", error);
			});
	});
</script>

<SwitchField
	title="Swipe between profiles"
	description="Swipe left or right to move between profiles opened from Browse. No navigation arrows are shown."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ profileSwipeNavigation: next }).catch((error) => {
				value = previous;
				showErrorToast({
					label: "Failed to save profile swipe preference",
					error,
				});
			});
		}
	}
/>
