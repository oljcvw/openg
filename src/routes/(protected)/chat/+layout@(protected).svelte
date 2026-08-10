<script lang="ts">
	import { page } from "$app/state";
	import { onMount, tick, untrack } from "svelte";
	import { cubicOut } from "svelte/easing";
	import type { TransitionConfig } from "svelte/transition";

	import {
		getInboxLayoutModeSnapshot,
		getKeepBottomNavigationBehindKeyboardSnapshot,
		type InboxLayoutMode,
		subscribePreferences,
	} from "$lib/app-data/preferences.svelte";
	import {
		getOrCreateConversationsState,
		setConversations,
	} from "$lib/chat/conversations-context.svelte";
	import NavBar from "$lib/components/shared/NavBar.svelte";
	import * as Card from "$lib/components/ui/card";
	import * as Resizable from "$lib/components/ui/resizable";
	import { setChatImeOverlayEnabled } from "$lib/platform/android-native-bridge";
	import { below } from "$lib/util/breakpoints.svelte";
	import { resolveInboxLayoutKind } from "./conversation-list-window";
	import ConversationsList from "./ConversationsList.svelte";

	let { data, children }: import("./$types").LayoutProps = $props();

	const conversations = untrack(() =>
		getOrCreateConversationsState(data.ourProfileId),
	);
	setConversations(conversations);

	let paneGroup: HTMLElement | null = $state(null);
	let conversationsListCollapsedSizePercentage = $state(0);
	let conversationsListMinWidthPercentage = $state(0);
	let pageContentMinWidthPercentage = $state(0);
	let keepBottomNavigationBehindKeyboard = $state(
		getKeepBottomNavigationBehindKeyboardSnapshot(),
	);
	let inboxLayoutMode: InboxLayoutMode = $state(getInboxLayoutModeSnapshot());
	let listSurface: HTMLDivElement | null = $state(null);
	let lastListFocus: HTMLElement | null = null;
	let wasChatSelected = false;

	onMount(() =>
		subscribePreferences(() => {
			keepBottomNavigationBehindKeyboard =
				getKeepBottomNavigationBehindKeyboardSnapshot();
			inboxLayoutMode = getInboxLayoutModeSnapshot();
		}),
	);

	$effect(() => {
		if (!paneGroup) return;
		const observer = new ResizeObserver(() => {
			if (!paneGroup) return;
			// 117 == --spacing-list-rail
			conversationsListCollapsedSizePercentage = 117 / paneGroup.offsetWidth;
			conversationsListMinWidthPercentage = 200 / paneGroup.offsetWidth;
			pageContentMinWidthPercentage = 280 / paneGroup.offsetWidth;
		});
		observer.observe(paneGroup);
		return () => observer.disconnect();
	});

	const isChatSelected = $derived(page.params.conversationId !== undefined);

	const mobile = below("split");
	const layoutKind = $derived(
		resolveInboxLayoutKind(inboxLayoutMode, mobile.current),
	);
	const split = $derived(layoutKind === "split");

	$effect(() => {
		const selected = isChatSelected;
		if (
			selected &&
			!wasChatSelected &&
			listSurface?.contains(document.activeElement)
		) {
			lastListFocus = document.activeElement as HTMLElement;
		}
		if (!selected && wasChatSelected && lastListFocus?.isConnected) {
			void tick().then(() => lastListFocus?.focus({ preventScroll: true }));
		}
		wasChatSelected = selected;
	});

	function conversationFrame(node: Element): TransitionConfig {
		void node;
		const reducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		return {
			duration: reducedMotion ? 0 : 220,
			easing: cubicOut,
			css: (t) =>
				`transform: translateX(${(1 - t) * 100}%); opacity: ${0.96 + t * 0.04}`,
		};
	}

	$effect(() => {
		const enabled =
			isChatSelected && !mobile.current && keepBottomNavigationBehindKeyboard;
		setChatImeOverlayEnabled(enabled);
		return () => setChatImeOverlayEnabled(false);
	});
</script>

<main
	class="relative flex h-dvh w-full flex-1 overflow-hidden pt-(--safe-area-top) pb-(--safe-area-bottom)"
>
	{#if split}
		<Resizable.PaneGroup
			direction="horizontal"
			class="mx-auto h-auto! max-h-full w-full max-w-360 max-split:hidden!"
			bind:ref={paneGroup}
			autoSaveId="/(protected)/chat/layout"
		>
			<Resizable.Pane
				defaultSize={43}
				minSize={conversationsListMinWidthPercentage * 100}
				collapsedSize={conversationsListCollapsedSizePercentage * 100}
				collapsible
				class="min-w-list-rail"
			>
				<ConversationsList class="pe-0.5" />
			</Resizable.Pane>
			<Resizable.Handle
				class="cursor-col-resize! bg-transparent px-1"
				withHandle
			/>
			<Resizable.Pane
				defaultSize={57}
				minSize={pageContentMinWidthPercentage * 100}
			>
				<div class="h-full flex-1 self-stretch p-2 ps-0.5 pb-nav-clear">
					<Card.Root
						class={[
							"relative h-full gap-0 rounded-chat-panel p-0 dark:ring-neutral-800",
							{
								"bg-card/20 ring-0": !isChatSelected,
							},
						]}
					>
						{@render children?.()}
					</Card.Root>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{:else}
		<div class="relative flex min-w-0 flex-1 overflow-hidden">
			<div
				bind:this={listSurface}
				class="absolute inset-0 flex min-w-0 flex-col"
				aria-hidden={isChatSelected}
				inert={isChatSelected}
			>
				<ConversationsList />
			</div>
			{#if isChatSelected}
				<div
					class="absolute inset-0 z-10 flex max-w-full flex-1 flex-col self-stretch bg-background will-change-transform"
					transition:conversationFrame
				>
					{@render children?.()}
				</div>
			{/if}
		</div>
	{/if}
</main>
{#if split || page.route.id !== "/(protected)/chat/[conversationId]"}
	<NavBar />
{/if}
