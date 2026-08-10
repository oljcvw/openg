<script lang="ts">
	import { ImageBrokenIcon, VideoIcon, XIcon } from "phosphor-svelte";

	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import type { AlbumContentResponse } from "$lib/api/messaging/albums";

	let {
		open = $bindable(false),
		album,
		onOpenItem,
	}: {
		open?: boolean;
		album: AlbumContentResponse | null;
		onOpenItem: (index: number, opener: HTMLButtonElement) => void;
	} = $props();
</script>

<Drawer.Root bind:open>
	<Drawer.Content
		class="h-[min(82dvh,48rem)] max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))]"
	>
		<Drawer.Header>
			<div class="flex min-w-0 items-start justify-between gap-3">
				<div class="min-w-0">
					<Drawer.Title class="truncate">
						{album?.albumName ?? "Received album"}
					</Drawer.Title>
					<Drawer.Description>
						{album === null
							? "Loading album media…"
							: `${album.content.length} ${album.content.length === 1 ? "item" : "items"}`}
					</Drawer.Description>
				</div>
				<Drawer.Close>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="icon-lg"
							aria-label="Close album drawer"
						>
							<XIcon class="size-5" />
						</Button>
					{/snippet}
				</Drawer.Close>
			</div>
		</Drawer.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-(--safe-area-bottom)">
			{#if album === null}
				<p class="py-10 text-center text-muted-foreground">Loading album…</p>
			{:else if album.content.length === 0}
				<p class="py-10 text-center text-muted-foreground">
					This album has no available media.
				</p>
			{:else}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
					{#each album.content as item, index (item.contentId)}
						<button
							type="button"
							class="group relative aspect-square overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-3 focus-visible:ring-primary/70 disabled:opacity-70"
							aria-label={`Open album item ${index + 1} of ${album.content.length}`}
							disabled={item.processing === true || item.rejectionId !== null}
							onclick={(event) => onOpenItem(index, event.currentTarget)}
						>
							{#if item.thumbUrl || item.coverUrl}
								<img
									src={item.thumbUrl || item.coverUrl || undefined}
									alt=""
									class="size-full object-cover transition-transform group-hover:scale-105"
									loading="lazy"
									draggable="false"
								/>
							{:else}
								<div class="flex size-full items-center justify-center">
									<ImageBrokenIcon class="size-8 text-muted-foreground" />
								</div>
							{/if}
							{#if item.contentType.startsWith("video/")}
								<span
									class="absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center rounded-full bg-black/70 text-white"
								>
									<VideoIcon weight="fill" class="size-4" />
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
