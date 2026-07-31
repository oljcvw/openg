<script lang="ts">
	import { CheckIcon, NotePencilIcon } from "phosphor-svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		FAVORITE_NOTE_MAX_LENGTH,
		favoriteNoteLength,
		getFavoriteNote,
		setFavoriteNote,
	} from "$lib/app-data/favorite-notes";
	import { Button } from "$lib/components/ui/button";
	import { Textarea } from "$lib/components/ui/textarea";

	let {
		accountProfileId,
		profileId,
		isFavorite,
	}: {
		accountProfileId: number;
		profileId: number;
		isFavorite: boolean;
	} = $props();

	let note = $state("");
	let savedNote = $state("");
	let loading = $state(false);
	let saving = $state(false);
	let loadedKey = $state<string | null>(null);
	let saved = $state(false);

	const length = $derived(favoriteNoteLength(note));
	const overLimit = $derived(length > FAVORITE_NOTE_MAX_LENGTH);
	const dirty = $derived(note !== savedNote);

	$effect(() => {
		const requestedKey = `${accountProfileId}:${profileId}`;
		if (!isFavorite || loadedKey === requestedKey) return;
		const requestedAccountProfileId = accountProfileId;
		const requestedProfileId = profileId;
		loading = true;
		saved = false;
		note = "";
		savedNote = "";
		void getFavoriteNote(requestedAccountProfileId, requestedProfileId)
			.then((value) => {
				if (
					accountProfileId !== requestedAccountProfileId ||
					profileId !== requestedProfileId
				)
					return;
				note = value;
				savedNote = value;
				loadedKey = requestedKey;
			})
			.catch((error) => {
				console.error(error);
				showErrorToast({ label: "Failed to load private note", error });
			})
			.finally(() => {
				if (
					accountProfileId === requestedAccountProfileId &&
					profileId === requestedProfileId
				)
					loading = false;
			});
	});

	async function save(): Promise<void> {
		if (saving || overLimit) return;
		saving = true;
		saved = false;
		try {
			await setFavoriteNote(accountProfileId, profileId, note);
			note = note.trim();
			savedNote = note;
			saved = true;
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to save private note", error });
		} finally {
			saving = false;
		}
	}

	async function deleteNote(): Promise<void> {
		if (saving || savedNote === "") return;
		saving = true;
		saved = false;
		try {
			await setFavoriteNote(accountProfileId, profileId, "");
			note = "";
			savedNote = "";
			saved = true;
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to delete private note", error });
		} finally {
			saving = false;
		}
	}
</script>

{#if isFavorite}
	<section class="mt-4 flex flex-col gap-2 rounded-2xl bg-card p-3">
		<div class="flex items-center justify-between gap-3">
			<span class="flex items-center gap-2 text-sm font-medium">
				<NotePencilIcon aria-hidden="true" class="size-4" />
				Private note
			</span>
			<span class="text-xs text-muted-foreground">Only on this device</span>
		</div>
		<Textarea
			bind:value={note}
			disabled={loading || saving}
			aria-invalid={overLimit}
			aria-label="Private note about this favorite"
			placeholder="Add a short note about this favorite"
			class="min-h-20 resize-y"
		/>
		<div class="flex items-center justify-between gap-3">
			<span
				class={[
					"text-xs text-muted-foreground",
					overLimit && "text-destructive",
				]}
			>
				{length}/{FAVORITE_NOTE_MAX_LENGTH}
			</span>
			<div class="flex items-center gap-2">
				{#if savedNote !== ""}
					<Button
						variant="destructive"
						size="sm"
						disabled={loading || saving}
						onclick={() => void deleteNote()}
					>
						Delete
					</Button>
				{/if}
				{#if saved}
					<span class="flex items-center gap-1 text-xs text-muted-foreground">
						<CheckIcon aria-hidden="true" class="size-3.5" />
						Saved
					</span>
				{/if}
				<Button
					size="sm"
					disabled={loading || saving || overLimit || !dirty}
					onclick={() => void save()}
				>
					{saving ? "Saving…" : "Save note"}
				</Button>
			</div>
		</div>
	</section>
{/if}
