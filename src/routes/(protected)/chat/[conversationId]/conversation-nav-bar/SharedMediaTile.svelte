<script lang="ts">
	import { lookupDirectMedia } from "$lib/app-data/direct-media-cache";
	import { queueVisibleDirectMedia } from "$lib/app-data/direct-media-retention";
	import {
		galleryPlayableUrl,
		type SharedMediaEntry,
	} from "$lib/chat/shared-media";

	let {
		entry,
		onOpen,
		onResolved = () => {},
	}: {
		entry: SharedMediaEntry;
		onOpen: (url: string, opener: HTMLButtonElement) => void;
		onResolved?: (url: string | null) => void;
	} = $props();

	let tile: HTMLButtonElement | null = $state(null);
	let cachedUrl = $state<string | null>(null);
	let entryGeneration = 0;
	// A consumptive URL must never enter DOM media attributes from enumeration.
	// Only an already-encrypted local copy is safe to expose in this gallery.
	const playableUrl = $derived(galleryPlayableUrl(entry, cachedUrl));

	$effect(() => {
		const currentEntry = entry;
		const generation = ++entryGeneration;
		let mounted = true;
		cachedUrl = null;
		void lookupDirectMedia(currentEntry)
			.then((result) => {
				if (!mounted || generation !== entryGeneration) return;
				if (result.found) cachedUrl = result.protocolUrl;
				onResolved(
					galleryPlayableUrl(
						currentEntry,
						result.found ? result.protocolUrl : null,
					),
				);
			})
			.catch(() => {
				if (mounted && generation === entryGeneration) onResolved(null);
			});
		onResolved(galleryPlayableUrl(currentEntry, null));
		const element = tile;
		if (!element || currentEntry.consumptive)
			return () => {
				mounted = false;
			};
		const observer = new IntersectionObserver(
			(records) => {
				if (!records.some((record) => record.isIntersecting)) return;
				void queueVisibleDirectMedia(currentEntry).then((url) => {
					if (mounted && generation === entryGeneration && url) {
						cachedUrl = url;
						onResolved(url);
					}
				});
				observer.disconnect();
			},
			{ rootMargin: "100px" },
		);
		observer.observe(element);
		return () => {
			mounted = false;
			observer.disconnect();
		};
	});
</script>

<button
	bind:this={tile}
	type="button"
	class="relative aspect-square overflow-hidden rounded-lg bg-muted text-start"
	disabled={playableUrl === null}
	onclick={(event) => playableUrl && onOpen(playableUrl, event.currentTarget)}
	aria-label={entry.kind === "image"
		? "Open received image"
		: "Open received video"}
>
	{#if playableUrl}
		{#if entry.kind === "image"}
			<img
				class="size-full object-cover"
				src={playableUrl}
				alt=""
				loading="lazy"
			/>
		{:else}
			<!-- svelte-ignore a11y_media_has_caption (user-generated chat video has no caption contract) -->
			<video
				class="size-full object-cover"
				src={playableUrl}
				preload="metadata"
				muted
			></video>
		{/if}
	{:else}
		<div
			class="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground"
		>
			{entry.consumptive
				? "Open the message to view once"
				: entry.cacheAvailability === "evicted"
					? "Cached copy no longer stored"
					: "Media unavailable"}
		</div>
	{/if}
	{#if entry.remoteAvailability !== "available" && cachedUrl}
		<span
			class="absolute right-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white"
		>
			Cached · {entry.remoteAvailability === "retracted"
				? "retracted"
				: "view limit reached"}
		</span>
	{/if}
</button>
