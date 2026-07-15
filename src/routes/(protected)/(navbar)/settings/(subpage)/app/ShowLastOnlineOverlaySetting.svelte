<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import { getPreferences, setPreferences } from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(true);

	onMount(() => {
		void getPreferences().then((preferences) => {
			value = preferences.showLastOnlineOverlay;
		});
	});
</script>

<SwitchField
	title="Show Last Online Overlay"
	description="Show online or last-active time on nearby profiles and message avatars."
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			void setPreferences({ showLastOnlineOverlay: next }).catch((error) => {
				value = previous;
				showErrorToast({ label: "Failed to save preferences", error });
			});
		}
	}
/>
