<script lang="ts">
	import {
		ArrowDownIcon,
		ArrowUpIcon,
		PencilSimpleIcon,
		PlusIcon,
		TrashIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import {
		addSavedPhrase,
		clearSavedPhrases,
		deleteSavedPhrase,
		DuplicateSavedPhraseError,
		listSavedPhrases,
		moveSavedPhrase,
		type SavedPhrase,
		subscribeSavedPhrases,
		updateSavedPhrase,
	} from "$lib/app-data/saved-phrases";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { getMessageComposerContext } from "../message-composer-context.svelte";

	let { active, onClose }: { active: boolean; onClose: () => void } = $props();
	const composer = $derived(getMessageComposerContext()());
	let phrases: SavedPhrase[] = $state([]);
	let editing = $state(false);
	let editingId: string | null = $state(null);
	let draft = $state("");

	async function load() {
		try {
			phrases = await listSavedPhrases(composer.accountProfileId);
		} catch (error) {
			showErrorToast({ label: "Failed to load saved phrases", error });
		}
	}

	$effect(() => {
		const accountId = composer.accountProfileId;
		if (active) void load();
		return subscribeSavedPhrases(accountId, () => void load());
	});

	function startNew() {
		editing = true;
		editingId = null;
		draft = "";
	}

	function startEdit(phrase: SavedPhrase) {
		editing = true;
		editingId = phrase.id;
		draft = phrase.text;
	}

	async function save() {
		try {
			if (editingId) {
				await updateSavedPhrase(composer.accountProfileId, editingId, draft);
			} else {
				await addSavedPhrase(composer.accountProfileId, draft);
			}
			editing = false;
			editingId = null;
			draft = "";
		} catch (error) {
			if (error instanceof DuplicateSavedPhraseError) {
				toast.info(error.message);
				return;
			}
			showErrorToast({ label: "Failed to save phrase", error });
		}
	}

	async function runMutation(label: string, mutation: () => Promise<unknown>) {
		try {
			await mutation();
		} catch (error) {
			showErrorToast({ label, error });
		}
	}
</script>

<div class="flex min-h-0 flex-col gap-3 pb-3">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-lg font-semibold">Saved Phrases</h3>
		<Button size="sm" variant="outline" onclick={startNew}
			><PlusIcon /> New</Button
		>
	</div>
	{#if editing}
		<form
			class="flex gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<Input
				bind:value={draft}
				placeholder="Saved phrase"
				aria-label="Saved phrase"
			/>
			<Button type="submit" disabled={draft.trim() === ""}>Save</Button>
			<Button type="button" variant="ghost" onclick={() => (editing = false)}
				>Cancel</Button
			>
		</form>
	{/if}
	{#if phrases.length === 0}
		<p class="py-8 text-center text-sm text-muted-foreground">
			No saved phrases yet.
		</p>
	{:else}
		<div class="flex max-h-80 flex-col gap-1 overflow-y-auto">
			{#each phrases as phrase, index (phrase.id)}
				<div class="flex items-center gap-1 rounded-xl border p-1">
					<button
						type="button"
						class="min-w-0 flex-1 truncate px-2 py-2 text-left"
						onclick={() => {
							composer.setText(phrase.text);
							onClose();
						}}>{phrase.text}</button
					>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Move phrase up"
						disabled={index === 0}
						onclick={() =>
							void runMutation("Failed to move phrase", () =>
								moveSavedPhrase(
									composer.accountProfileId,
									phrase.id,
									index - 1,
								),
							)}><ArrowUpIcon /></Button
					>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Move phrase down"
						disabled={index === phrases.length - 1}
						onclick={() =>
							void runMutation("Failed to move phrase", () =>
								moveSavedPhrase(
									composer.accountProfileId,
									phrase.id,
									index + 1,
								),
							)}><ArrowDownIcon /></Button
					>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Edit phrase"
						onclick={() => startEdit(phrase)}><PencilSimpleIcon /></Button
					>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Delete phrase"
						onclick={() =>
							void runMutation("Failed to delete phrase", () =>
								deleteSavedPhrase(composer.accountProfileId, phrase.id),
							)}><TrashIcon /></Button
					>
				</div>
			{/each}
		</div>
		<Button
			variant="destructive"
			disabled={phrases.length === 0}
			onclick={() => {
				if (confirm("Delete all saved phrases for this account?"))
					void runMutation("Failed to clear saved phrases", () =>
						clearSavedPhrases(composer.accountProfileId),
					);
			}}>Clear All Saved Phrases</Button
		>
	{/if}
</div>
