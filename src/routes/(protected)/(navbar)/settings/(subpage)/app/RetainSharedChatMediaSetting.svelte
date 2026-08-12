<script lang="ts">
	import { onMount } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getPreferences,
		getRetainSharedChatMediaSnapshot,
	} from "$lib/app-data/preferences.svelte";
	import { setSharedMediaRetentionPreference } from "$lib/app-data/shared-media-retention-preference";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let value = $state(getRetainSharedChatMediaSnapshot());
	let loaded = $state(false);

	onMount(() => {
		void getPreferences()
			.then((preferences) => {
				value = preferences.retainSharedChatMedia;
				loaded = true;
			})
			.catch((error) => {
				console.error(
					"Failed to load shared-media retention preference",
					error,
				);
			});
	});
</script>

<SwitchField
	title="Retain shared chat media"
	description="Cache ordinary incoming media when a gallery tile becomes visible, and retain view-once media after you explicitly view it. Cached media can remain after the sender retracts it. Retention lasts until cache eviction, you disable this setting, clear the cache, or sign out."
	disabled={!loaded}
	bind:checked={
		() => value,
		(next: boolean) => {
			const previous = value;
			value = next;
			void setSharedMediaRetentionPreference(next).catch((error) => {
				value = previous;
				showErrorToast({
					label: next
						? "Failed to save shared-media retention preference"
						: "Failed to disable retention and clear shared-media caches",
					error,
				});
			});
		}
	}
/>
