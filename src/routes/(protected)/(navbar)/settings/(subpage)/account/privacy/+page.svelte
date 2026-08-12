<script lang="ts">
	import { onMount } from "svelte";

	import {
		type AccountPreferences,
		type AccountPreferencesUpdate,
		getAccountPreferences,
		setAccountPreferences,
	} from "$lib/api/account";
	import { showErrorToast } from "$lib/api/error";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";
	import ShowDistanceSetting from "./ShowDistanceSetting.svelte";

	let { data }: import("./$types").PageProps = $props();

	let settings = $state<AccountPreferences | null>(null);
	let updating = $state<Set<keyof AccountPreferencesUpdate>>(new Set());

	onMount(() => {
		void load();
	});

	async function load(): Promise<void> {
		try {
			settings = await getAccountPreferences();
		} catch (error) {
			showErrorToast({
				label: "Failed to load privacy settings",
				error,
				onRetry: () => void load(),
			});
		}
	}

	async function update(
		key: keyof AccountPreferencesUpdate,
		value: boolean,
	): Promise<void> {
		// Each write is followed by a whole-object reconciliation GET. Keep
		// mutations serial so an older response or rollback cannot overwrite a
		// different setting that completed later.
		if (!settings || updating.size > 0) return;
		const previous = settings;
		updating = new Set(updating).add(key);
		settings = { ...settings, [key]: value };
		try {
			await setAccountPreferences({ [key]: value });
		} catch (error) {
			settings = previous;
			showErrorToast({ label: "Failed to update privacy setting", error });
			return;
		}
		try {
			settings = await getAccountPreferences();
		} catch (error) {
			// The remote mutation succeeded. Preserve the optimistic value so the
			// UI never claims the prior privacy state is still active.
			showErrorToast({
				label: "Privacy setting updated, but refresh failed",
				error,
			});
		} finally {
			const next = new Set(updating);
			next.delete(key);
			updating = next;
		}
	}
</script>

<ShowDistanceSetting ourProfileId={data.ourProfileId} />
{#if settings}
	<SwitchField
		title="Incognito"
		description="Browse without appearing in Viewed Me."
		bind:checked={
			() => settings?.incognito ?? false,
			(value) => void update("incognito", value)
		}
		disabled={updating.size > 0}
	/>
	<SwitchField
		title="Hide Viewed Me"
		description="Keep the list of profiles that viewed you private."
		bind:checked={
			() => settings?.hideViewedMe ?? false,
			(value) => void update("hideViewedMe", value)
		}
		disabled={updating.size > 0}
	/>
	<SwitchField
		title="Approximate distance"
		description="Use a less precise distance when your distance is shown."
		bind:checked={
			() => settings?.approximateDistance ?? false,
			(value) => void update("approximateDistance", value)
		}
		disabled={updating.size > 0}
	/>
	<SwitchField
		title="Exclude from location search"
		description="Do not include your profile in location-based search results."
		bind:checked={
			() => settings?.locationSearchOptOut ?? false,
			(value) => void update("locationSearchOptOut", value)
		}
		disabled={updating.size > 0}
	/>
	<SwitchField
		title="Show NSFW Right Now posts"
		description="Allow mature posts to appear in Right Now."
		bind:checked={
			() => settings?.viewRightNowNsfw ?? false,
			(value) => void update("viewRightNowNsfw", value)
		}
		disabled={updating.size > 0}
	/>
	{#if settings.showOnMap !== undefined}
		<SwitchField
			title="Show on map"
			description="Allow your profile to appear on supported map views."
			bind:checked={
				() => settings?.showOnMap ?? false,
				(value) => void update("showOnMap", value)
			}
			disabled={updating.size > 0}
		/>
	{/if}
{:else}
	{#each Array(5)}
		<Skeleton class="h-24 w-full rounded-xl" />
	{/each}
{/if}
