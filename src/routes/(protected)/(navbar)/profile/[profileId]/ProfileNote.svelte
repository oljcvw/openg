<script lang="ts">
	import { NotePencilIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import { fade } from "svelte/transition";

	import { showErrorToast } from "$lib/api/error";
	import { updateFavoriteUserNote } from "$lib/api/users/favorites";
	import Button from "$lib/components/ui/button/button.svelte";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Spinner } from "$lib/components/ui/spinner";
	import type { FavoriteNote } from "$lib/model/favorites";
	import type { Profile } from "$lib/model/users/profiles";
	import MultilineField from "../../settings/(subpage)/profile/fields/MultilineField.svelte";
	import TextField from "../../settings/(subpage)/profile/fields/TextField.svelte";

	let {
		profile,
		note = $bindable(),
	}: { profile: Profile | null; note: FavoriteNote | null } = $props();

	const NOTE_MAX_LENGTH = 250;
	const PHONE_MAX_LENGTH = 20;

	let open = $state(false);
	let saving = $state(false);
	let notesValue = $state("");
	let phoneValue = $state("");

	$effect(() => {
		if (!open || !note) return;
		notesValue = note.notes;
		phoneValue = note.phoneNumber;
	});

	const dirty = $derived(
		note !== null &&
			(notesValue !== note.notes || phoneValue !== note.phoneNumber),
	);

	const wrongLength = $derived(
		notesValue.length > NOTE_MAX_LENGTH || phoneValue.length > PHONE_MAX_LENGTH,
	);

	async function save() {
		if (saving || !dirty || profile == null) return;
		saving = true;
		try {
			const updated = {
				notes: notesValue.trim(),
				phoneNumber: phoneValue.trim(),
			};
			await updateFavoriteUserNote(profile?.profileId, updated);
			note = updated;
			open = false;
			toast.success("Note updated");
		} catch (error) {
			showErrorToast({ label: "Failed to update note", error });
		} finally {
			saving = false;
		}
	}
</script>

{#if note && profile?.isFavorite}
	<div
		class="absolute top-2 right-2 z-10 max-w-1/3"
		transition:fade={{ duration: 100 }}
	>
		<Button
			size="sm"
			variant="default"
			aria-label="Profile note"
			class="w-full min-w-0 cursor-pointer text-base"
			onclick={() => (open = true)}
		>
			<NotePencilIcon weight="fill" class="size-4 shrink-0" />
			{#if note.notes.trim().length > 0}
				<span class="truncate">{note.notes}</span>
			{/if}
		</Button>
	</div>
	<Drawer.Root bind:open>
		<Drawer.Content class="flex flex-col">
			<div class="flex flex-col gap-1.5 p-4">
				<MultilineField
					label="Note"
					bind:value={notesValue}
					maxLength={NOTE_MAX_LENGTH}
					placeholder="Add a note..."
					class="max-h-40 overflow-y-auto"
				/>
				<TextField
					label="Phone number"
					bind:value={phoneValue}
					maxLength={PHONE_MAX_LENGTH}
					placeholder="Add a phone number..."
				/>
			</div>
			<Drawer.Footer>
				<Button
					disabled={saving || !dirty || wrongLength}
					onclick={() => save()}
				>
					{#if saving}
						<Spinner class="size-4" />
					{/if}
					Save
				</Button>
			</Drawer.Footer>
		</Drawer.Content>
	</Drawer.Root>
{/if}
