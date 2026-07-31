<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPreferences,
		getShowProfileNavigationButtonsSnapshot,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getShowProfileNavigationButtonsSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.showProfileNavigationButtons;
				loaded = true;
			})
			.catch((error) => {
				console.error(
					"Failed to load profile navigation button preference",
					error,
				);
			});
	});
</script>

<SwitchField
	title="Show profile navigation buttons"
	description="Show accessible Previous and Next buttons when viewing Browse profiles, and enable keyboard arrow navigation."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ showProfileNavigationButtons: next }).catch((error) => {
				value = previous;
				showErrorToast({
					label: "Failed to save profile navigation button preference",
					error,
				});
			});
		}
	}
/>
