<script lang="ts">
	import { tick, untrack } from "svelte";

	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		resolveConversationScrollRestoration,
	} from "$lib/navigation/navigation-memory";
	import { getConversationState } from "../conversation-state.svelte";
	import ConversationError from "./ConversationError.svelte";
	import MessagesList from "./MessagesList.svelte";
	import MessagesListSkeleton from "./MessagesListSkeleton.svelte";
	import ScrollToBottomButton from "./ScrollToBottomButton.svelte";

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
						offsetPx?: number | null;
					},
				) => Promise<boolean>;
		  }
		| undefined = $state();

	const FLOOR_SLOP_PX = 16;

	let atFloor = $state(true);
	let seenTimestamp = $state(0);

	$effect(() => {
		markReadMessagesEffect();
	});

	function markReadMessagesEffect(): void {
		if (!atFloor) return;
		const latest = conversationState.messages.reduce(
			(max, m) => Math.max(max, m.timestamp),
			0,
		);
		untrack(() => {
			if (latest > seenTimestamp) {
				seenTimestamp = latest;
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
		if (!container) return;
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
		el.addEventListener("wheel", endScrollingToRest, { passive: true });
		el.addEventListener("touchstart", endScrollingToRest, { passive: true });
		return () => {
			el.removeEventListener("wheel", endScrollingToRest);
			el.removeEventListener("touchstart", endScrollingToRest);
		};
	}

	let scrollDone = false;
	let lastFirstId = "";

	$effect(() => {
		onConversationChangeEffect();
	});

	function onConversationChangeEffect(): void {
		void conversationState.conversationId;
		untrack(() => {
			scrollDone = false;
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
		if (!conversationState.loading && !scrollDone && container) {
			scrollDone = true;
			const state = conversationState;
			const detailSession = navigationMemory.getDetailSession(
				state.conversationId,
				state.accountSession,
			);
			const anchor = detailSession.scrollAnchor;
			if (!anchor) {
				void scrollToRest("instant");
				return;
			}
			const el = container;
			void (async () => {
				if (anchor.distanceFromEndPx > FLOOR_SLOP_PX && anchor.itemKey) {
					await messagesList?.scrollToMessage(anchor.itemKey, {
						align: "start",
						behavior: "auto",
						offsetPx: anchor.offsetPx,
					});
				}
				await tick();
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
				el.scrollTop = restored.scrollTop;
				atFloor = floorDistance() <= FLOOR_SLOP_PX;
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
</script>

<div
	class="relative flex min-h-0 max-w-full flex-1 flex-col"
	style:--composer-height="{composerHeight}px"
	style:padding-bottom="var(--chat-ime-offset, 0px)"
>
	<div
		class="flex min-h-0 max-w-full flex-1 flex-col gap-1 overflow-auto overscroll-contain p-2 pt-20 pb-[calc(var(--composer-height)+--spacing(1.5))] *:first:mt-auto"
		bind:this={container}
		style:overflow-anchor="none"
		onscroll={onContainerScroll}
		onscrollend={onContainerScrollEnd}
	>
		{#if conversationState.loading}
			{#key conversationState.conversationId}
				<MessagesListSkeleton />
			{/key}
		{:else if conversationState.error}
			<ConversationError />
		{:else}
			<MessagesList {container} bind:seenTimestamp bind:this={messagesList} />
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
		{#if !atFloor}
			<ScrollToBottomButton
				{seenTimestamp}
				onclick={() => void scrollToRest("smooth")}
			/>
		{/if}
	{/if}
</div>
