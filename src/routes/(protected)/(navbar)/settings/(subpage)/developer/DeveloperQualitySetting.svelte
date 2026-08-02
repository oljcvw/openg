<script lang="ts">
	import { untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		getDeveloperSettingsSnapshot,
		setDeveloperSettings,
		type VideoCallQualityPreset,
	} from "$lib/app-data/preferences.svelte";
	import * as Item from "$lib/components/ui/item";
	import * as ToggleGroup from "$lib/components/ui/toggle-group";

	let value = $state<VideoCallQualityPreset>(
		untrack(() => getDeveloperSettingsSnapshot().videoCallQualityPreset),
	);
	let saving = $state(false);

	async function save(next: string): Promise<void> {
		if (next !== "auto" && next !== "high" && next !== "low") return;
		const previous = value;
		value = next;
		saving = true;
		try {
			await setDeveloperSettings({ videoCallQualityPreset: next });
		} catch (error) {
			value = previous;
			showErrorToast({ label: "Failed to save video-call quality", error });
		} finally {
			saving = false;
		}
	}
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Video-call quality</Item.Title>
		<Item.Description>
			Choose automatic adaptation, higher detail, or lower bandwidth.
		</Item.Description>
	</Item.Content>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		class="w-full"
		disabled={saving}
		bind:value={() => value, (next) => void save(next)}
	>
		<ToggleGroup.Item value="auto" class="flex-1 justify-center">
			Auto
		</ToggleGroup.Item>
		<ToggleGroup.Item value="high" class="flex-1 justify-center">
			High
		</ToggleGroup.Item>
		<ToggleGroup.Item value="low" class="flex-1 justify-center">
			Low
		</ToggleGroup.Item>
	</ToggleGroup.Root>
</Item.Root>
