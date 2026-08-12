<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPreferences,
		getStayAwakeSnapshot,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getStayAwakeSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.stayAwake;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load Stay Awake preference", error);
			});
	});
</script>

<SwitchField
	title="Stay awake"
	description="Keep the screen on while Open Grind is visible. This can increase battery use."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ stayAwake: next }).catch((error) => {
				value = previous;
				showErrorToast({
					label: "Failed to save Stay Awake preference",
					error,
				});
			});
		}
	}
/>
