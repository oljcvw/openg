<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import {
		type CacheUsage,
		clearAllCachedData,
		setCacheLimitMb,
		subscribeCacheUsage,
	} from "$lib/app-data/cache-manager";
	import {
		getCacheSizeMbSnapshot,
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";

	let value = $state(getCacheSizeMbSnapshot());
	let usage = $state<CacheUsage>({
		limitBytes: getCacheSizeMbSnapshot() * 1024 * 1024,
		usedBytes: 0,
	});
	let loaded = $state(false);
	let clearOpen = $state(false);
	let clearing = $state(false);

	onMount(() => {
		const unsubscribe = subscribeCacheUsage(
			(next) => (usage = next),
			(error) => showErrorToast({ label: "Failed to load cache usage", error }),
		);
		void getPreferences()
			.then((preferences) => {
				value = preferences.cacheSizeMb;
				loaded = true;
			})
			.catch((error) =>
				showErrorToast({ label: "Failed to load cache settings", error }),
			);
		return unsubscribe;
	});

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	async function save(event: Event) {
		const next = Number((event.currentTarget as HTMLInputElement).value);
		const previous = value;
		value = next;
		try {
			await setPreferences({ cacheSizeMb: next });
			await setCacheLimitMb(next);
		} catch (error) {
			value = previous;
			showErrorToast({ label: "Failed to save cache size", error });
		}
	}

	async function clearCache() {
		clearing = true;
		try {
			await clearAllCachedData();
			clearOpen = false;
			toast.success("Cached data cleared");
		} catch (error) {
			showErrorToast({ label: "Failed to clear cached data", error });
		} finally {
			clearing = false;
		}
	}
</script>

<Item.Root variant="outline" class="gap-3 p-4">
	<Item.Content class="gap-1">
		<Item.Title>Cached data</Item.Title>
		<Item.Description>
			Using {formatBytes(usage.usedBytes)} of {value} MB. Cached profiles, Browse
			results, and messages make the app faster and remain on this device.
		</Item.Description>
	</Item.Content>
	<label class="flex items-center gap-3">
		<span class="w-16 text-sm tabular-nums">{value} MB</span>
		<input
			type="range"
			min="10"
			max="1000"
			step="10"
			disabled={!loaded}
			{value}
			onchange={save}
			class="min-w-0 flex-1"
		/>
	</label>
	<Button variant="outline" onclick={() => (clearOpen = true)}
		>Clear cached data</Button
	>
</Item.Root>

<AlertDialog.Root bind:open={clearOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Clear all cached data?</AlertDialog.Title>
			<AlertDialog.Description>
				Profiles, Browse results, Inbox history, and failed messages stored on
				this device will be removed. Account data on the service will not
				change.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={clearing}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={clearing} onclick={() => void clearCache()}>
				Clear cached data
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
