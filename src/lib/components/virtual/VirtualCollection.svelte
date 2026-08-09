<script lang="ts" generics="T">
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { onDestroy, type Snippet, tick, untrack } from "svelte";

	import { runtimeOwnership } from "$lib/dev/runtime-ownership";

	const releaseCollection = runtimeOwnership.acquire("virtual-collection");
	onDestroy(releaseCollection);

	let {
		items,
		scrollElement,
		getKey,
		estimateSize,
		overscan = 4,
		gap = 0,
		children,
		class: className = "",
	}: {
		items: readonly T[];
		scrollElement: HTMLElement | null;
		getKey: (item: T, index: number) => string | number;
		estimateSize: number | ((index: number) => number);
		overscan?: number;
		gap?: number;
		children: Snippet<[T, number]>;
		class?: string;
	} = $props();

	let root: HTMLDivElement | null = $state(null);
	let scrollMargin = $state(0);
	const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => scrollElement,
		estimateSize: () => 80,
		overscan: 4,
		gap: 0,
		initialRect: { width: 0, height: 640 },
	});

	$effect(() => {
		const snapshot = items;
		const size = estimateSize;
		const keyForItem = getKey;
		const currentOverscan = overscan;
		const currentGap = gap;
		const currentScrollMargin = scrollMargin;
		untrack(() =>
			$virtualizer.setOptions({
				count: snapshot.length,
				getScrollElement: () => scrollElement,
				getItemKey: (index) => keyForItem(snapshot[index], index),
				estimateSize: typeof size === "function" ? size : () => size,
				measureElement: (element, _entry, instance) =>
					element.getBoundingClientRect().height ||
					(typeof size === "function"
						? size(instance.indexFromElement(element))
						: size),
				overscan: currentOverscan,
				gap: currentGap,
				scrollMargin: currentScrollMargin,
			}),
		);
	});

	$effect(() => {
		if (!root) return;
		const update = () => {
			scrollMargin = root?.offsetTop ?? 0;
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const releaseObserver = runtimeOwnership.acquire("observer");
		const observer = new ResizeObserver(update);
		observer.observe(root);
		return () => {
			observer.disconnect();
			releaseObserver();
		};
	});

	function measureElement(node: HTMLDivElement) {
		const releaseRow = runtimeOwnership.acquire("virtual-row");
		$virtualizer.measureElement(node);
		return {
			destroy() {
				releaseRow();
			},
		};
	}

	export async function scrollToIndex(index: number): Promise<void> {
		if (index < 0 || index >= items.length) return;
		const offset = $virtualizer.getOffsetForIndex(index, "start")?.[0];
		if (scrollElement && offset !== undefined) scrollElement.scrollTop = offset;
		$virtualizer.setOptions({ getScrollElement: () => scrollElement });
		await tick();
		$virtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
		scrollElement?.dispatchEvent(new Event("scroll"));
		await tick();
	}

	const virtualItems = $derived($virtualizer.getVirtualItems());
	const totalSize = $derived($virtualizer.getTotalSize());
</script>

<div
	bind:this={root}
	class={["relative w-full", className]}
	style:height={`${totalSize}px`}
>
	{#each virtualItems as virtualItem (virtualItem.key)}
		<div
			class="absolute top-0 left-0 w-full"
			data-index={virtualItem.index}
			data-virtual-key={String(virtualItem.key)}
			style:transform={`translateY(${virtualItem.start - scrollMargin}px)`}
			use:measureElement
		>
			{@render children(items[virtualItem.index], virtualItem.index)}
		</div>
	{/each}
</div>
