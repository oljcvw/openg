<script lang="ts">
	import { EyeSlashIcon } from "phosphor-svelte";
	import { onMount } from "svelte";

	import {
		getHiddenProfiles,
		type HiddenProfile,
		unhideAllProfiles,
		unhideProfile,
	} from "$lib/api/browse/hides";
	import { showErrorToast } from "$lib/api/error";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Skeleton } from "$lib/components/ui/skeleton";

	let profiles = $state<HiddenProfile[] | null>(null);
	let clearDialogOpen = $state(false);
	let clearing = $state(false);

	onMount(() => void load());

	async function load(): Promise<void> {
		try {
			profiles = await getHiddenProfiles();
		} catch (error) {
			showErrorToast({
				label: "Failed to load hidden users",
				error,
				onRetry: () => void load(),
			});
		}
	}

	async function unhide(profileId: number): Promise<void> {
		try {
			await unhideProfile(profileId);
			profiles =
				profiles?.filter((profile) => profile.profileId !== profileId) ?? [];
		} catch (error) {
			showErrorToast({ label: "Failed to unhide profile", error });
		}
	}

	async function clearAll(): Promise<void> {
		clearing = true;
		try {
			await unhideAllProfiles();
			profiles = [];
			clearDialogOpen = false;
		} catch (error) {
			showErrorToast({ label: "Failed to unhide profiles", error });
		} finally {
			clearing = false;
		}
	}
</script>

{#if profiles === null}
	{#each Array(3)}
		<Skeleton class="h-17 w-full rounded-xl" />
	{/each}
{:else if profiles.length === 0}
	<Empty.Root class="border">
		<Empty.Header>
			<Empty.Media variant="icon"><EyeSlashIcon /></Empty.Media>
			<Empty.Title>No hidden users</Empty.Title>
			<Empty.Description>Profiles you hide will appear here.</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{:else}
	<div class="flex justify-end">
		<Button
			variant="outline"
			size="sm"
			onclick={() => (clearDialogOpen = true)}
		>
			Unhide all
		</Button>
	</div>
	<Item.Group>
		{#each profiles as profile (profile.profileId)}
			<Item.Root variant="outline">
				<Item.Content>
					<Item.Title>
						{profile.displayName || `Profile ${profile.profileId}`}
					</Item.Title>
					<Item.Description>Profile {profile.profileId}</Item.Description>
				</Item.Content>
				<Item.Actions>
					<Button
						variant="outline"
						size="sm"
						onclick={() => void unhide(profile.profileId)}
					>
						Unhide
					</Button>
				</Item.Actions>
			</Item.Root>
		{/each}
	</Item.Group>
{/if}

<AlertDialog.Root bind:open={clearDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Unhide everyone?</AlertDialog.Title>
			<AlertDialog.Description>
				Every hidden profile will be visible in your browse experience again.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={clearing}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={clearing} onclick={() => void clearAll()}>
				Unhide all
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
