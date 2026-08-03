<script lang="ts">
	import { untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		type GeneralDeveloperSettings,
		getDeveloperSettingsSnapshot,
		setDeveloperSettings,
	} from "$lib/app-data/preferences.svelte";
	import { Input } from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";

	let {
		setting,
		title,
		description,
		min,
		max,
		step = 1,
		unit,
		onsaved,
	}: {
		setting: keyof GeneralDeveloperSettings;
		title: string;
		description: string;
		min: number;
		max: number;
		step?: number;
		unit: string;
		onsaved?: (value: number) => void | Promise<void>;
	} = $props();

	let value = $state(untrack(() => getDeveloperSettingsSnapshot()[setting]));
	let saving = $state(false);

	async function save(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const next = Number(input.value);
		if (!Number.isInteger(next) || next < min || next > max) {
			input.value = String(value);
			return;
		}
		const previous = value;
		value = next;
		saving = true;
		try {
			await setDeveloperSettings({ [setting]: next });
		} catch (error) {
			value = previous;
			showErrorToast({ label: `Failed to save ${title}`, error });
			return;
		} finally {
			saving = false;
		}
		if (onsaved) {
			try {
				await onsaved(next);
			} catch (error) {
				showErrorToast({ label: `Failed to apply ${title}`, error });
			}
		}
	}
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>{title}</Item.Title>
		<Item.Description class="line-clamp-none">{description}</Item.Description>
	</Item.Content>
	<label class="flex w-full flex-wrap items-center gap-3">
		<Input
			type="number"
			class="w-28 max-w-full"
			{min}
			{max}
			{step}
			disabled={saving}
			value={String(value)}
			onchange={save}
		/>
		<span class="text-sm text-muted-foreground">{unit}</span>
	</label>
</Item.Root>
