<script lang="ts">
	import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
	import ImageIcon from "phosphor-svelte/lib/ImageIcon";
	import NavigationArrowIcon from "phosphor-svelte/lib/NavigationArrowIcon";
	import { expoOut, sineIn } from "svelte/easing";
	import { fly } from "svelte/transition";

	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import * as Tabs from "$lib/components/ui/tabs";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import ComposerAlbumsTab from "./ComposerAlbumsTab.svelte";
	import ComposerLocationTab from "./ComposerLocationTab.svelte";
	import ComposerMediaTab from "./ComposerMediaTab.svelte";

	const FULLSIZE_TABS: Tab[] = ["media"];

	let {
		open = $bindable(),
	}: {
		open: boolean;
	} = $props();

	type Tab = "media" | "albums" | "location";

	let selectedTab = $state("media");

	const isFullsizeTab = $derived(FULLSIZE_TABS.includes(selectedTab));

	let sheet = $state<HTMLDivElement | null>(null);
	let peek = $state<HTMLDivElement | null>(null);
	let mediaTab = $state<ComposerMediaTab | null>(null);
	let selectedCount = $state(0);

	const settleQuietMs = 140;
	let settleTimer: ReturnType<typeof setTimeout> | null = null;

	function settleToNearestSize() {
		const el = sheet;
		const range = peek?.offsetHeight ?? 0;
		if (!el || el.scrollTop <= 0 || el.scrollTop >= range) return;
		el.scrollTo({
			top: el.scrollTop < range / 2 ? 0 : range,
			behavior: "smooth",
		});
	}

	function scheduleSettle() {
		if (settleTimer !== null) clearTimeout(settleTimer);
		settleTimer = setTimeout(() => {
			settleTimer = null;
			settleToNearestSize();
		}, settleQuietMs);
	}

	$effect(() => {
		if (!open) {
			if (settleTimer !== null) clearTimeout(settleTimer);
			settleTimer = null;
			return;
		}
		const dismiss = () => {
			open = false;
			return false;
		};
		backGestureEventHandlers.add(dismiss);
		return () => {
			backGestureEventHandlers.delete(dismiss);
		};
	});
</script>

<Drawer.Root bind:open>
	<Drawer.Content
		class={[
			"mx-auto max-w-200 border-none bg-transparent p-0 shadow-none before:hidden",
			{ "h-full": isFullsizeTab, "h-fit": !isFullsizeTab },
		]}
		handle={null}
		style:bottom="var(--chat-ime-offset, 0px)"
		onclick={(e) => {
			if (
				e.target instanceof HTMLDivElement &&
				e.target.dataset.slot === "sheet-scroller"
			) {
				open = false;
			}
		}}
	>
		<Tabs.Root
			bind:value={selectedTab}
			class={["min-h-0 gap-0", { "h-full": isFullsizeTab }]}
		>
			<div
				bind:this={sheet}
				data-slot="sheet-scroller"
				onscroll={scheduleSettle}
				class={[
					"overflow-x-hidden  overscroll-contain select-none",
					{
						"h-full overflow-y-auto": isFullsizeTab,
						"h-fit": !isFullsizeTab,
					},
				]}
			>
				{#if isFullsizeTab}
					<div
						bind:this={peek}
						data-slot="sheet-peek"
						class="pointer-events-none h-2/5"
					></div>
				{/if}
				<div
					data-slot="sheet-panel"
					class={[
						"rounded-t-4xl border border-border bg-popover px-4 pb-[calc(var(--nav-height)+0.75rem)] shadow-xl",
						{
							"min-h-full": isFullsizeTab,
						},
					]}
				>
					<div
						data-slot="drawer-handle"
						class="mx-auto my-3 h-1.5 w-25 rounded-full bg-muted"
					></div>
					<Tabs.Content value="media">
						<ComposerMediaTab
							bind:this={mediaTab}
							onSelectionChange={(count) => {
								selectedCount = count;
							}}
							onClose={() => (open = false)}
						/>
					</Tabs.Content>
					<Tabs.Content value="albums">
						<!-- Tabs.Content renders regardless of the active tab, so the
						     tab is told whether it is showing rather than fetching
						     albums every time the sheet opens. -->
						<ComposerAlbumsTab
							active={selectedTab === "albums"}
							onClose={() => (open = false)}
						/>
					</Tabs.Content>
					<Tabs.Content value="location">
						<ComposerLocationTab
							active={open && selectedTab === "location"}
							onClose={() => (open = false)}
						/>
					</Tabs.Content>
				</div>
			</div>

			{#if selectedCount > 0}
				<div
					class="pointer-events-none absolute inset-x-0 bottom-[calc(var(--nav-height)+0.5rem)] flex justify-center"
					in:fly={{ duration: 600, y: 100, easing: expoOut }}
					out:fly={{ duration: 400, y: 100, easing: sineIn }}
				>
					<Button
						size="lg"
						class="pointer-events-auto shadow-lg"
						onclick={() => {
							mediaTab?.sendSelected();
						}}
					>
						Send
						<Badge
							variant="secondary"
							class="bg-primary-foreground/10 text-primary-foreground"
						>
							{selectedCount}
						</Badge>
					</Button>
				</div>
			{/if}

			<Drawer.Footer
				class="absolute inset-x-0 bottom-0 items-center rounded-b-4xl px-[clamp(0.5rem,2vw,1.5rem)] pt-1 pb-2 select-none"
			>
				<Tabs.List
					class="min-h-[calc(var(--nav-height)-0.5rem)] w-full gap-[clamp(0.5rem,2vw,1rem)]"
				>
					{@render tab("media")}
					{@render tab("albums")}
					{@render tab("location")}
				</Tabs.List>
			</Drawer.Footer>
		</Tabs.Root>
	</Drawer.Content>
</Drawer.Root>

{#snippet tab(tab: Tab)}
	<Tabs.Trigger
		value={tab}
		class="h-auto min-w-0 flex-col gap-0.5 px-[clamp(0.5rem,2vw,1rem)] py-1 text-[clamp(0.75rem,2vw,0.9375rem)]"
	>
		{#if tab === "media"}
			<ImageIcon weight="fill" class="size-[clamp(1.25rem,3.5vw,1.75rem)]" />
			Media
		{:else if tab === "albums"}
			<FolderOpenIcon
				weight="fill"
				class="size-[clamp(1.25rem,3.5vw,1.75rem)]"
			/>
			Albums
		{:else if tab === "location"}
			<NavigationArrowIcon
				weight="fill"
				class="size-[clamp(1.25rem,3.5vw,1.75rem)]"
			/>
			Location
		{/if}
	</Tabs.Trigger>
{/snippet}
