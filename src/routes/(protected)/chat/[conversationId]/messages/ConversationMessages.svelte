<script lang="ts">
	import { onDestroy, tick, untrack } from "svelte";

	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import { backLayerManager } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		resolveConversationScrollRestoration,
	} from "$lib/navigation/navigation-memory";
	import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
	import { getConversationState } from "../conversation-state.svelte";
	import ConversationError from "./ConversationError.svelte";
	import MessagesList from "./MessagesList.svelte";
	import MessagesListSkeleton from "./MessagesListSkeleton.svelte";
	import ScrollToBottomButton from "./ScrollToBottomButton.svelte";
	import {
		addTranscriptRestorationCancellationListeners,
		canCaptureTranscriptViewport,
		isTranscriptRestorationCurrent,
		nextTranscriptSeenTimestamp,
		restoreMeasuredTranscript,
		transcriptRestorationCancellationState,
		type TranscriptRestoreTarget,
	} from "./transcript-restoration";
	import VoiceNoteNavigator from "./VoiceNoteNavigator.svelte";

	let {
		composerHeight,
	}: {
		composerHeight: number;
	} = $props();

	const conversationState = $derived(getConversationState()());

	let container: HTMLDivElement | null = $state(null);
	let refreshControl: DataRefreshControl | undefined = $state();
	let messagesList:
		| {
				scrollToMessage: (
					messageId: string,
					options?: {
						align?: "start" | "center" | "end" | "auto";
						behavior?: ScrollBehavior;
						isCurrent?: () => boolean;
						offsetPx?: number | null;
					},
				) => Promise<boolean>;
				scrollToVoiceNote: (messageId: string) => Promise<boolean>;
		  }
		| undefined = $state();

	const FLOOR_SLOP_PX = 16;

	let atFloor = $state(true);
	let seenTimestamp = $state(0);

	$effect(() => {
		markReadMessagesEffect();
	});

	function markReadMessagesEffect(): void {
		conversationState.setReadBoundaryReady(scrollDone && atFloor);
		const latest = conversationState.messages.reduce(
			(max, m) => Math.max(max, m.timestamp),
			0,
		);
		const next = nextTranscriptSeenTimestamp({
			atFloor,
			latestTimestamp: latest,
			restorationComplete: scrollDone,
			seenTimestamp,
		});
		untrack(() => {
			if (next > seenTimestamp) {
				seenTimestamp = next;
			}
		});
	}

	function floorDistance() {
		if (!container) return 0;
		return (
			container.scrollHeight - container.clientHeight - container.scrollTop
		);
	}

	let scrollingToRest = false;
	let scrollingToRestTimer: ReturnType<typeof setTimeout> | null = null;

	async function scrollToRest(behavior: ScrollBehavior) {
		await tick();
		atFloor = true;
		if (behavior === "smooth") {
			scrollingToRest = true;
			if (scrollingToRestTimer !== null) clearTimeout(scrollingToRestTimer);
			scrollingToRestTimer = setTimeout(endScrollingToRest, 1500);
		}
		refreshControl?.scrollToRest(behavior);
		if (behavior === "instant" && container)
			container.scrollTop = container.scrollHeight;
		if (floorDistance() <= 1) endScrollingToRest();
	}

	function endScrollingToRest() {
		scrollingToRest = false;
		if (scrollingToRestTimer !== null) {
			clearTimeout(scrollingToRestTimer);
			scrollingToRestTimer = null;
		}
	}

	function onContainerScroll() {
		if (scrollingToRest) {
			if (floorDistance() <= 1) endScrollingToRest();
			return;
		}
		atFloor = floorDistance() <= FLOOR_SLOP_PX;
		captureTranscriptAnchor(conversationState);
	}

	function onContainerScrollEnd() {
		endScrollingToRest();
		atFloor = floorDistance() <= FLOOR_SLOP_PX;
		captureTranscriptAnchor(conversationState);
	}

	function captureTranscriptAnchor(state: typeof conversationState): void {
		if (!container || !canCaptureTranscriptViewport(scrollDone, restoring))
			return;
		const anchor = captureScrollAnchor(
			container,
			Date.now(),
			"[data-message-id]",
			"data-message-id",
		);
		navigationMemory.setConversationScrollAnchor(
			state.conversationId,
			{ ...anchor, distanceFromEndPx: floorDistance() },
			state.accountSession,
			captureScrollNeighborhood(
				container,
				anchor.itemKey,
				"[data-message-id]",
				"data-message-id",
			),
		);
	}

	$effect(() => {
		const state = conversationState;
		return () => captureTranscriptAnchor(state);
	});

	$effect(() => {
		return addInputEventsEffect();
	});

	function addInputEventsEffect() {
		const el = container;
		if (!el) return;
		const cancelProgrammaticScroll = () => {
			restoreGeneration += 1;
			restoring = false;
			const cancellation =
				transcriptRestorationCancellationState(floorDistance());
			atFloor = cancellation.atFloor;
			scrollDone = cancellation.restorationComplete;
			endScrollingToRest();
		};
		return addTranscriptRestorationCancellationListeners(
			el,
			cancelProgrammaticScroll,
		);
	}

	let scrollDone = $state(false);
	let restoring = $state(false);
	let restoreGeneration = 0;
	onDestroy(() => {
		restoreGeneration += 1;
		endScrollingToRest();
	});
	let lastFirstId = "";

	$effect(() => {
		onConversationChangeEffect();
	});

	function onConversationChangeEffect(): void {
		void conversationState.conversationId;
		untrack(() => {
			conversationState.resetReadBoundary();
			restoreGeneration += 1;
			scrollDone = false;
			restoring = false;
			lastFirstId = "";
			atFloor = true;
			seenTimestamp = 0;
			endScrollingToRest();
		});
	}

	$effect(() => {
		onConversationLoadedEffect();
	});

	function onConversationLoadedEffect(): void {
		if (!conversationState.loading && !scrollDone && !restoring && container) {
			restoring = true;
			const state = conversationState;
			const detailSession = navigationMemory.getDetailSession(
				state.conversationId,
				state.accountSession,
			);
			const anchor = detailSession.scrollAnchor;
			const el = container;
			const generation = ++restoreGeneration;
			const isCurrentRestoration = (candidate: number) =>
				isTranscriptRestorationCurrent({
					accountSession: state.accountSession,
					candidateGeneration: candidate,
					ownsContainer: container === el,
					ownsConversationState: conversationState === state,
					restoreGeneration,
				});
			const target: TranscriptRestoreTarget =
				anchor && anchor.distanceFromEndPx > FLOOR_SLOP_PX && anchor.itemKey
					? {
							kind: "anchor",
							messageId: anchor.itemKey,
							offsetPx: anchor.offsetPx,
							distanceFromEndPx: anchor.distanceFromEndPx,
						}
					: { kind: "floor" };
			void (async () => {
				const outcome = await restoreMeasuredTranscript({
					target,
					generation,
					isCurrent: isCurrentRestoration,
					scrollToAnchor: async (messageId, offsetPx, isCurrent) => {
						const found =
							(await messagesList?.scrollToMessage(messageId, {
								align: "start",
								behavior: "auto",
								isCurrent,
								offsetPx,
							})) ?? false;
						if (!found || !anchor || !isCurrent()) return false;
						await tick();
						if (!isCurrent()) return false;
						const containerRect = el.getBoundingClientRect();
						const offsets = new Map<string, number>();
						for (const item of el.querySelectorAll<HTMLElement>(
							"[data-message-id]",
						)) {
							const key = item.dataset.messageId;
							if (key)
								offsets.set(
									key,
									el.scrollTop +
										item.getBoundingClientRect().top -
										containerRect.top,
								);
						}
						const restored = resolveConversationScrollRestoration(
							anchor,
							offsets,
							{
								scrollHeight: el.scrollHeight,
								clientHeight: el.clientHeight,
								floorSlopPx: FLOOR_SLOP_PX,
							},
							detailSession.scrollNeighborhood,
						);
						if (!isCurrent()) return false;
						el.scrollTop = restored.scrollTop;
						return true;
					},
					scrollToFloor: () => {
						refreshControl?.scrollToRest("instant");
						el.scrollTop = el.scrollHeight;
					},
					measure: (messageId) => {
						const row = messageId
							? [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
									(candidate) => candidate.dataset.messageId === messageId,
								)
							: null;
						return {
							floorDistancePx: floorDistance(),
							anchorOffsetPx: row
								? row.getBoundingClientRect().top -
									el.getBoundingClientRect().top
								: null,
						};
					},
					waitFrame: () =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() => resolve()),
						),
				});
				if (!isCurrentRestoration(generation)) return;
				restoring = false;
				scrollDone = outcome !== "superseded";
				atFloor = floorDistance() <= FLOOR_SLOP_PX;
				if (outcome === "failed")
					reportClientDiagnostic({
						category: "background_task",
						component: "conversation",
						code: "transcript_restore_failed",
						level: "warning",
					});
			})();
		}
	}

	$effect(() => {
		onNewMessageEffect();
	});

	function onNewMessageEffect(): void {
		const firstMessage = conversationState.messages.at(0);
		const firstId = firstMessage?.messageId ?? "";
		if (
			scrollDone &&
			firstMessage &&
			firstId &&
			firstId !== lastFirstId &&
			lastFirstId !== ""
		) {
			if (untrack(() => atFloor)) {
				void scrollToRest("smooth");
			}
		}
		lastFirstId = firstId;
	}

	$effect(() => {
		onComposerResizeEffect();
	});

	function onComposerResizeEffect(): void {
		void composerHeight;
		const el = container;
		if (!el) return;
		untrack(() => {
			if (!atFloor) return;
			el.scrollTop = el.scrollHeight;
		});
	}

	let pinnedVoiceNote: string | null = null;
	$effect(() => {
		if (!conversationState.voiceNotes.active) return;
		const releaseBackLayer = backLayerManager.register({
			priority: "localMode",
			handler: () => {
				conversationState.voiceNotes.exit();
				return "handled";
			},
		});
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			conversationState.voiceNotes.exit();
		};
		window.addEventListener("keydown", onKeydown, true);
		return () => {
			releaseBackLayer();
			window.removeEventListener("keydown", onKeydown, true);
		};
	});

	$effect(() => {
		const active = conversationState.voiceNotes.active;
		const selected = conversationState.voiceNotes.selectedKey;
		const list = messagesList;
		untrack(() => {
			if (
				pinnedVoiceNote !== null &&
				(!active || pinnedVoiceNote !== selected)
			) {
				conversationState.unpinMessage(pinnedVoiceNote, "voice-note");
				pinnedVoiceNote = null;
			}
			if (!active || selected === null || !list) return;
			if (pinnedVoiceNote !== selected) {
				conversationState.pinMessage(selected, "voice-note");
				pinnedVoiceNote = selected;
			}
			void list.scrollToVoiceNote(selected);
		});
	});

	onDestroy(() => {
		if (pinnedVoiceNote !== null)
			conversationState.unpinMessage(pinnedVoiceNote, "voice-note");
	});
</script>

<div
	class="relative flex min-h-0 max-w-full flex-1 flex-col"
	style:--composer-height="{composerHeight}px"
	style:--chat-composer-overlay-height={conversationState.voiceNotes.active
		? "3.5rem"
		: "0px"}
	style:padding-bottom="var(--chat-ime-offset, 0px)"
>
	<div
		aria-label="Conversation messages"
		role="region"
		class="flex min-h-0 max-w-full flex-1 flex-col gap-1 overflow-auto overscroll-contain p-2 pt-20 pb-[calc(var(--composer-height)+--spacing(1.5))] *:first:mt-auto"
		bind:this={container}
		style:overflow-anchor="none"
		onscroll={onContainerScroll}
		onscrollend={onContainerScrollEnd}
		onpointerdown={(event) => {
			if (!conversationState.voiceNotes.active) return;
			const target = event.target as HTMLElement;
			if (
				target.closest(
					"[data-voice-note-interactive], [data-message-type='Audio']",
				)
			)
				return;
			conversationState.voiceNotes.exit();
		}}
	>
		{#if conversationState.loading}
			{#key conversationState.conversationId}
				<MessagesListSkeleton />
			{/key}
		{:else if conversationState.error}
			<ConversationError />
		{:else}
			<MessagesList
				{container}
				readReportingEnabled={scrollDone}
				bind:seenTimestamp
				bind:this={messagesList}
			/>
		{/if}
	</div>
	{#if !conversationState.loading && !conversationState.error}
		<DataRefreshControl
			bind:this={refreshControl}
			{container}
			updating={conversationState.refreshing}
			containerClass="bottom-(--composer-height)"
			hintOffset={8}
			position="bottom"
			onrefresh={() => void conversationState.refresh()}
		/>
		{#if conversationState.voiceNotes.active}
			<VoiceNoteNavigator
				state={conversationState.voiceNotes}
				onOlder={() => conversationState.voiceNotes.selectOlder()}
				onNewer={() => conversationState.voiceNotes.selectNewer()}
				onExit={() => conversationState.voiceNotes.exit()}
			/>
		{/if}
		{#if !atFloor}
			<ScrollToBottomButton
				{seenTimestamp}
				onclick={() => void scrollToRest("smooth")}
			/>
		{/if}
	{/if}
</div>
