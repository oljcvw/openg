<script lang="ts">
	import { untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import {
		filterSavedPhrases,
		listSavedPhrases,
		type SavedPhrase,
		subscribeSavedPhrases,
	} from "$lib/app-data/saved-phrases";
	import {
		type ApiResponseMessage,
		type Message,
		previewFromMessage,
		previewLabel,
	} from "$lib/model/messaging/messages";
	import { navigationMemory } from "$lib/navigation/navigation-memory";
	import type { AccountSessionSnapshot } from "$lib/api/account-caches";
	import type { SendOwnershipTransfer } from "../conversation-state.svelte";
	import ComposerAttachments from "./attachments/ComposerAttachments.svelte";
	import ComposerCamera from "./ComposerCamera.svelte";
	import ComposerSubmitButton from "./ComposerSubmitButton.svelte";
	import { setMessageComposerContext } from "./message-composer-context.svelte";
	import MessageTextInput from "./MessageTextInput.svelte";
	import ComposerVoiceMessage from "./voice-message/ComposerVoiceMessage.svelte";

	let {
		onSend,
		disabled,
		accountProfileId,
		replyTarget,
		otherName,
		onCancelReply,
		conversationId,
		accountSession,
		height = $bindable(0),
	}: {
		onSend: (params: Message) => Promise<SendOwnershipTransfer>;
		disabled: boolean;
		accountProfileId: number;
		conversationId: string;
		accountSession: AccountSessionSnapshot;
		replyTarget?: ApiResponseMessage | null;
		otherName?: string | null;
		onCancelReply?: () => void;
		height?: number;
	} = $props();

	let draftOwnerKey = $state("");
	let textContent = $state("");
	let form: HTMLFormElement | null = $state(null);
	let savedPhrases: SavedPhrase[] = $state([]);
	let savedPhrasesAccountId: number | null = $state(null);
	let savedPhrasesGeneration = 0;

	$effect(() => {
		const id = conversationId;
		const session = accountSession;
		const nextOwnerKey = `${session.generation}:${id}`;
		untrack(() => {
			if (nextOwnerKey === draftOwnerKey) return;
			draftOwnerKey = nextOwnerKey;
			textContent = navigationMemory.getDetailSession(id, session).draftText;
		});
	});

	$effect(() => {
		const id = conversationId;
		const session = accountSession;
		const ownerKey = `${session.generation}:${id}`;
		const text = textContent;
		if (ownerKey !== draftOwnerKey) return;
		const draft = navigationMemory.getDetailSession(id, session);
		navigationMemory.updateDraft(
			id,
			{ text, replyTargetMessageId: draft.replyTargetMessageId },
			session,
		);
	});

	async function loadSavedPhrases(profileId: number, generation: number) {
		try {
			const phrases = await listSavedPhrases(profileId);
			if (
				accountProfileId === profileId &&
				generation === savedPhrasesGeneration
			) {
				savedPhrases = phrases;
				savedPhrasesAccountId = profileId;
			}
		} catch (error) {
			if (
				accountProfileId === profileId &&
				generation === savedPhrasesGeneration
			)
				showErrorToast({ label: "Failed to load saved phrases", error });
		}
	}

	$effect(() => {
		const id = accountProfileId;
		const generation = ++savedPhrasesGeneration;
		savedPhrases = [];
		savedPhrasesAccountId = null;
		void loadSavedPhrases(id, generation);
		const unsubscribe = subscribeSavedPhrases(
			id,
			() => void loadSavedPhrases(id, generation),
		);
		return () => {
			if (generation === savedPhrasesGeneration) savedPhrasesGeneration += 1;
			unsubscribe();
		};
	});

	const phraseSuggestions = $derived(
		savedPhrasesAccountId === accountProfileId
			? filterSavedPhrases(savedPhrases, textContent)
			: [],
	);

	async function onSubmit() {
		const text = textContent.trim();
		if (text === "") return;
		try {
			const accepted = await onSend({ type: "Text", body: { text } });
			if (accepted?.kind !== "accepted") return;
			navigationMemory.clearDraft(conversationId, accountSession);
			textContent = "";
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to send message",
				error,
			});
		}
	}

	setMessageComposerContext(() => ({
		accountProfileId,
		disabled,
		sendMessage: onSend,
		setText: (text: string) => (textContent = text),
	}));
</script>

<form
	bind:this={form}
	class="absolute bottom-0 z-20 min-h-9.5 w-full min-w-0 shrink-0 px-2 pb-2"
	bind:clientHeight={height}
	style:bottom="var(--chat-ime-offset, 0px)"
	oninput={() => {
		// WebKit bug: resive observer emits event a frame late,
		// painting the taller composer over the newest message once
		if (form) height = form.clientHeight;
	}}
	onsubmit={(event) => {
		event.preventDefault();
		onSubmit().catch((error) => console.error(error));
	}}
>
	{#if replyTarget}
		<div
			class="mb-1 flex items-center gap-2 rounded-lg border-s-4 border-primary bg-popover px-3 py-2 text-sm shadow-sm"
		>
			<div class="min-w-0 flex-1">
				<strong class="block truncate">
					Replying to {replyTarget.senderId === accountProfileId
						? "yourself"
						: (otherName ?? "profile")}
				</strong>
				<span class="block truncate text-muted-foreground">
					{previewLabel(previewFromMessage(replyTarget)) ?? "Message"}
				</span>
			</div>
			<button
				type="button"
				class="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
				onclick={onCancelReply}
				aria-label="Cancel reply"
			>
				Cancel
			</button>
		</div>
	{/if}
	{#if phraseSuggestions.length > 0}
		<div
			class="mb-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1"
			aria-label="Saved phrase suggestions"
		>
			{#each phraseSuggestions as phrase (phrase.id)}
				<button
					type="button"
					class="max-w-64 shrink-0 truncate rounded-full border bg-popover px-3 py-1.5 text-sm hover:bg-muted"
					onclick={() => (textContent = phrase.text)}
				>
					{phrase.text}
				</button>
			{/each}
		</div>
	{/if}
	<div class="relative h-full w-full rounded-composer bg-popover">
		<MessageTextInput bind:value={textContent} />
		<ComposerCamera />
		{#if textContent === ""}
			<ComposerAttachments />
			<ComposerVoiceMessage />
		{:else}
			<ComposerSubmitButton />
		{/if}
	</div>
</form>
