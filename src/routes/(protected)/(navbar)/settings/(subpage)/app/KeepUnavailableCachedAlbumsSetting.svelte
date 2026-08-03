<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getKeepUnavailableCachedAlbumsSnapshot,
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getKeepUnavailableCachedAlbumsSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.keepUnavailableCachedAlbums;
				loaded = true;
			})
			.catch((error) => {
				console.error("Failed to load retained-album preference", error);
			});
	});
</script>

<SwitchField
	title="Keep cached albums available"
	description="Allow locally cached shared albums after access is revoked, the album is removed or expires, or its view limit is reached. Status remains visible in the viewer."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			setPreferences({ keepUnavailableCachedAlbums: next }).catch((error) => {
				value = previous;
				showErrorToast({
					label: "Failed to save cached-album preference",
					error,
				});
			});
		}
	}
/>
