<script lang="ts">
	import { untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		type GeneralDeveloperSettings,
		getDeveloperSettingsSnapshot,
		setDeveloperSettings,
	} from "$lib/app-data/preferences.svelte";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let {
		setting,
		title,
		description,
		onsaved,
	}: {
		setting: {
			[K in keyof GeneralDeveloperSettings]: GeneralDeveloperSettings[K] extends boolean
				? K
				: never;
		}[keyof GeneralDeveloperSettings];
		title: string;
		description: string;
		onsaved?: (value: boolean) => void | Promise<void>;
	} = $props();

	let value = $state(untrack(() => getDeveloperSettingsSnapshot()[setting]));
	let saving = $state(false);

	async function save(next: boolean): Promise<void> {
		const previous = value;
		value = next;
		saving = true;
		try {
			await setDeveloperSettings({ [setting]: next });
			await onsaved?.(next);
		} catch (error) {
			value = previous;
			showErrorToast({ label: `Failed to save ${title}`, error });
		} finally {
			saving = false;
		}
	}
</script>

<SwitchField
	{title}
	{description}
	disabled={saving}
	bind:checked={() => value, (next) => void save(next)}
/>
