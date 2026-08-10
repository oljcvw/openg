<script lang="ts">
	import { ChatCircleIcon, PaperPlaneTiltIcon } from "phosphor-svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import { showErrorToast } from "$lib/api/error";
	import {
		filterSavedPhrases,
		listSavedPhrases,
		type SavedPhrase,
		subscribeSavedPhrases,
	} from "$lib/app-data/saved-phrases";
	import {
		type DirectMessageSendRequest,
		getDirectMessageSession,
	} from "$lib/chat/direct-message-session";
	import { Button } from "$lib/components/ui/button";
	import {
		interceptAppNavigationClick,
		replaceAppDetail,
	} from "$lib/navigation/app-navigation";
	import { navigationMemory } from "$lib/navigation/navigation-memory";

	let {
		ourProfileId,
		profileId,
		disabled = false,
	}: {
		ourProfileId: number;
		profileId: number;
		disabled?: boolean;
	} = $props();

	const conversationId = $derived(
		[profileId, ourProfileId].toSorted((a, b) => a - b).join(":"),
	);
	const accountSession = getAccountSessionSnapshot();
	let text = $state("");
	let ownerKey = $state("");
	let phrases: SavedPhrase[] = $state([]);
	let sending = $state(false);
	let delivery: "idle" | "sent" | "confirming" | "failed" = $state("idle");
	let retryRequest: DirectMessageSendRequest | null = null;

	$effect(() => {
		const key = `${accountSession.generation}:${conversationId}`;
		if (key === ownerKey) return;
		ownerKey = key;
		text = navigationMemory.getDetailSession(
			conversationId,
			accountSession,
		).draftText;
	});

	$effect(() => {
		const id = conversationId;
		const value = text;
		if (`${accountSession.generation}:${id}` !== ownerKey) return;
		const current = navigationMemory.getDetailSession(id, accountSession);
		navigationMemory.updateDraft(
			id,
			{ text: value, replyTargetMessageId: current.replyTargetMessageId },
			accountSession,
		);
	});

	async function refreshPhrases(accountId: number): Promise<void> {
		try {
			phrases = await listSavedPhrases(accountId);
		} catch (error) {
			showErrorToast({ label: "Failed to load saved phrases", error });
		}
	}

	$effect(() => {
		const accountId = ourProfileId;
		void refreshPhrases(accountId);
		return subscribeSavedPhrases(
			accountId,
			() => void refreshPhrases(accountId),
		);
	});

	const suggestions = $derived(filterSavedPhrases(phrases, text));

	async function submit(): Promise<void> {
		const value = text.trim();
		if (disabled || sending || value === "") return;
		sending = true;
		delivery = "idle";
		const request =
			retryRequest?.message.type === "Text" &&
			retryRequest.message.body.text === value
				? retryRequest
				: {
						message: { type: "Text" as const, body: { text: value } },
						attemptRef: crypto.randomUUID(),
						commandRef: crypto.randomUUID(),
					};
		try {
			const outcome = await getDirectMessageSession({
				accountProfileId: ourProfileId,
				conversationId,
				toUserId: profileId,
			}).send(request);
			if (outcome.kind !== "ack" && outcome.kind !== "unknown") {
				delivery = "failed";
				retryRequest = request;
				return;
			}
			delivery = outcome.kind === "ack" ? "sent" : "confirming";
			retryRequest = null;
			navigationMemory.clearDraft(conversationId, accountSession);
			text = "";
		} catch (error) {
			delivery = "failed";
			retryRequest = request;
			showErrorToast({ label: "Failed to send message", error });
		} finally {
			sending = false;
		}
	}
</script>

<div class="relative flex min-w-0 flex-1 items-center gap-1">
	{#if suggestions.length > 0}
		<div
			class="absolute inset-x-0 bottom-[calc(100%+0.5rem)] flex max-w-full gap-1 overflow-x-auto rounded-xl bg-background/95 p-1 shadow-md backdrop-blur-xl"
			aria-label="Saved phrase suggestions"
		>
			{#each suggestions as phrase (phrase.id)}
				<button
					type="button"
					class="max-w-56 shrink-0 truncate rounded-full border bg-popover px-3 py-1.5 text-sm"
					aria-label={phrase.text}
					onclick={() => {
						text = phrase.text;
						delivery = "idle";
						retryRequest = null;
					}}
				>
					{phrase.text}
				</button>
			{/each}
		</div>
	{/if}

	<form
		class="flex min-w-0 flex-1 items-center gap-1 rounded-full border bg-input/20 py-1 ps-3 pe-1 focus-within:ring-3 focus-within:ring-primary/40"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<textarea
			bind:value={text}
			rows="1"
			aria-label="Message this profile"
			placeholder={disabled ? "Messaging unavailable" : "Write a message…"}
			disabled={disabled || sending}
			class="max-h-24 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none"
			oninput={() => {
				delivery = "idle";
				retryRequest = null;
			}}
		></textarea>
		<Button
			type="submit"
			size="icon"
			aria-label={delivery === "failed" ? "Retry message" : "Send message"}
			disabled={disabled || sending || text.trim() === ""}
		>
			<PaperPlaneTiltIcon weight="fill" />
		</Button>
	</form>

	<Button
		variant="outline"
		size="icon-lg"
		href="/chat/{conversationId}"
		aria-label="Open full conversation"
		onclick={(event) =>
			interceptAppNavigationClick(event, () =>
				replaceAppDetail(`/chat/${conversationId}`),
			)}
	>
		<ChatCircleIcon weight="fill" />
	</Button>
	<span class="sr-only" aria-live="polite">
		{delivery === "sent"
			? "Message sent"
			: delivery === "confirming"
				? "Delivery confirming"
				: delivery === "failed"
					? "Message failed"
					: ""}
	</span>
</div>
