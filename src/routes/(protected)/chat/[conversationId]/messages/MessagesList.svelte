<script lang="ts">
	import { toast } from "svelte-sonner";

	import { promptCopyError } from "$lib/api/error-copy";
	import { showErrorToast } from "$lib/api/error-toast";
	import { tieredFeature } from "$lib/api/error-urn";
	import {
		deleteMessageForMe,
		unsendMessage,
	} from "$lib/api/messaging/messages";
<<<<<<< HEAD
	import { openExternalLink } from "$lib/platform/link-opener";
	import { getConversationState } from "../conversation-state.svelte";
=======
	import ReportSheet from "$lib/components/report/ReportSheet.svelte";
	import { offerEntitlementBypass } from "$lib/entitlements/bypass.svelte";
	import {
		type ConversationState,
		getConversationState,
		type OptimisticMessage,
	} from "../conversation-state.svelte";
>>>>>>> origin/forgejo-sync
	import { processMessages } from "../messages";
	import Message from "./message/Message.svelte";

	let { seenMessageIds }: { seenMessageIds: Set<string> } = $props();

	let reportOpen = $state(false);
	let reportProfileId = $state<number | null>(null);

	const conversationState = $derived(getConversationState()());

	const messages = $derived(
		processMessages({
			messages: conversationState.messages,
			ourProfileId: conversationState.ourProfileId,
		}),
	);

<<<<<<< HEAD
	function reportUnsendFailure(error: unknown) {
		if (tieredFeature(error) === "UnsentMessage") {
			toast.error("Unsend feature now requires Grindr subscription", {
				id: "unsend-paywall",
				action: {
					label: "Learn more",
					onClick: () =>
						openExternalLink(
							"https://git.opengrind.org/open-grind/open-grind/issues/319#issuecomment-2453",
						),
				},
			});
			return;
		}
		showErrorToast({ label: "Failed to unsend message", error });
=======
	async function unsend({
		state,
		messageId,
	}: {
		state: ConversationState;
		messageId: string;
	}) {
		const { revert } = state.markMessageAsUnsent(messageId);
		try {
			await unsendMessage({
				conversationId: state.conversationId,
				messageId,
			});
		} catch (error) {
			revert();
			throw error;
		}
	}

	async function requestUnsend(messageId: string) {
		const state = conversationState;
		try {
			await unsend({ state, messageId });
		} catch (error) {
			console.error(error);
			if (tieredFeature(error) === "UnsentMessage") {
				offerEntitlementBypass({
					reason: "Unsending a message requires a Grindr subscription.",
					retry: () => unsend({ state, messageId }),
				});
				return;
			}
			showErrorToast({ label: "Failed to unsend message", error });
		}
	}

	async function deleteForMe(message: OptimisticMessage) {
		const state = conversationState;
		const { revert } = state.remove(message.messageId);
		if (message.status === "error") return;
		try {
			await deleteMessageForMe({
				conversationId: state.conversationId,
				messageId: message.messageId,
			});
		} catch (error) {
			console.error(error);
			showErrorToast({ label: "Failed to delete message", error });
			revert();
		}
>>>>>>> origin/forgejo-sync
	}
</script>

{#each messages.toReversed() as message (message.messageId)}
	{@const isOut = message.senderId === conversationState.ourProfileId}
	{@const delivered = message.status === "sent"}
	<Message
		{message}
		{isOut}
		indexInStack={message.indexInStack}
		stackLength={message.stackLength}
		dayStart={message.dayStart}
		status={message.status}
		isRead={isOut && message.messageId === messages[0]?.messageId
			? conversationState.lastReadTimestamp === message.timestamp
			: null}
		onVisible={!isOut
			? () => {
					seenMessageIds.add(message.messageId);
					conversationState.reportRead(message);
				}
			: undefined}
		onDelete={message.status === "pending"
			? undefined
			: () => deleteForMe(message)}
		onReply={delivered && !message.unsent
			? () => conversationState.setReplyTo(message)
			: undefined}
		onReport={!isOut && conversationState.profile
			? () => {
					reportProfileId =
						conversationState.profile?.profileId ?? null;
					reportOpen = reportProfileId !== null;
				}
			: undefined}
		onReact={async (reactionType: number) => {
			try {
				await conversationState.reactTo({
					messageId: message.messageId,
					reactionType,
				});
			} catch (error) {
				console.error(error);
				showErrorToast({ label: "Failed to react to message", error });
			}
		}}
<<<<<<< HEAD
		onUnsend={isOut && !message.unsent
			? async () => {
					let revert: (() => void) | undefined;
					try {
						({ revert } = conversationState.markMessageAsUnsent(
							message.messageId,
						));
						await unsendMessage({
							conversationId: conversationState.conversationId,
							messageId: message.messageId,
						});
					} catch (error) {
						console.error(error);
						reportUnsendFailure(error);
						revert?.();
					}
				}
=======
		onUnsend={isOut && delivered && !message.unsent
			? () => void requestUnsend(message.messageId)
>>>>>>> origin/forgejo-sync
			: undefined}
		onCopyError={message.status === "error"
			? () => void promptCopyError(message.sendError).catch(() => {})
			: undefined}
	/>
{/each}

{#if reportProfileId !== null}
	<ReportSheet
		bind:open={reportOpen}
		profileId={reportProfileId}
		locations={["CHAT_MESSAGE"]}
	/>
{/if}
