<script lang="ts">
	import { UserMinusIcon } from "phosphor-svelte";
	import { onMount } from "svelte";

	import {
		type BlockedProfile,
		getBlockedProfiles,
	} from "$lib/api/browse/blocked-profiles";
	import { unblockAllUsers, unblockUser } from "$lib/api/browse/blocks";
	import { showErrorToast } from "$lib/api/error";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Skeleton } from "$lib/components/ui/skeleton";

	let profiles = $state<BlockedProfile[] | null>(null);
	let clearDialogOpen = $state(false);
	let clearing = $state(false);

	onMount(() => void load());

	async function load(): Promise<void> {
		try {
			profiles = await getBlockedProfiles();
		} catch (error) {
			showErrorToast({
				label: "Failed to load blocked users",
				error,
				onRetry: () => void load(),
			});
		}
	}

	async function unblock(profileId: number): Promise<void> {
		try {
			await unblockUser({ profileId });
			profiles =
				profiles?.filter((profile) => profile.profileId !== profileId) ?? [];
		} catch (error) {
			showErrorToast({ label: "Failed to unblock profile", error });
		}
	}

	async function clearAll(): Promise<void> {
		clearing = true;
		try {
			await unblockAllUsers();
			profiles = [];
			clearDialogOpen = false;
		} catch (error) {
			showErrorToast({ label: "Failed to unblock profiles", error });
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
			<Empty.Media variant="icon"><UserMinusIcon /></Empty.Media>
			<Empty.Title>No blocked users</Empty.Title>
			<Empty.Description>
				Profiles you block will appear here.
			</Empty.Description>
		</Empty.Header>
	</Empty.Root>
{:else}
	<div class="flex justify-end">
		<Button
			variant="outline"
			size="sm"
			onclick={() => (clearDialogOpen = true)}
		>
			Unblock all
		</Button>
	</div>
	<Item.Group>
		{#each profiles as profile (profile.profileId)}
			{@const displayName =
				profile.displayName || `Profile ${profile.profileId}`}
			<Item.Root variant="outline">
				<Item.Media variant="image">
					<UserAvatar mediaHash={profile.mediaHash} class="size-full" />
				</Item.Media>
				<Item.Content>
					<Item.Title>{displayName}</Item.Title>
					<Item.Description>
						Blocked {new Date(profile.blockedTime).toLocaleDateString()}
					</Item.Description>
				</Item.Content>
				<Item.Actions>
					<Button
						variant="outline"
						size="sm"
						aria-label="Unblock {displayName}"
						onclick={() => void unblock(profile.profileId)}
					>
						Unblock
					</Button>
				</Item.Actions>
			</Item.Root>
		{/each}
	</Item.Group>
{/if}

<AlertDialog.Root bind:open={clearDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Unblock everyone?</AlertDialog.Title>
			<AlertDialog.Description>
				Every blocked profile will be able to contact and find you again.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={clearing}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={clearing} onclick={() => void clearAll()}>
				Unblock all
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
