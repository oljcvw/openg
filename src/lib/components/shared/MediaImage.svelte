<script lang="ts">
<<<<<<< HEAD
=======
	import { Skeleton } from "$lib/components/ui/skeleton";
>>>>>>> origin/forgejo-sync
	import {
		loadWhenVisible,
		TRANSPARENT_PIXEL,
	} from "$lib/util/load-when-visible";
<<<<<<< HEAD
=======
	import {
		acquireMediaLoadSlot,
		releaseWhenSettled,
	} from "$lib/util/media-load-slots";
>>>>>>> origin/forgejo-sync
	import BrokenMedia from "./BrokenMedia.svelte";

	let {
		src,
		alt = "",
		class: className,
		imgClass,
		aspectRatio,
		fallbackAspectRatio = "3 / 4",
		tone = "muted",
		size = "sm",
		loading,
		pending = false,
		failedSrc = $bindable(null),
		onload,
	}: {
		src: string | null;
		alt?: string;
		class?: import("svelte/elements").ClassValue;
		imgClass?: import("svelte/elements").ClassValue;
		aspectRatio?: string;
		fallbackAspectRatio?: string;
		tone?: "muted" | "photo";
		size?: "xs" | "sm" | "md" | "lg" | "xl";
		loading?: "eager" | "lazy";
		pending?: boolean;
		failedSrc?: string | null;
		onload?: (image: HTMLImageElement) => void;
	} = $props();

	let armed = $state(false);
	const deferred = $derived(loading === "lazy" && !armed);
<<<<<<< HEAD
=======
	const requested = $derived(
		pending || deferred || failedSrc === src ? null : src,
	);

	let slotGranted = $state(false);
	let shownSrc = $state<string | null>(null);
	let imageElement = $state<HTMLImageElement>();
	let releaseSlot = () => {};

	$effect.pre(() => {
		slotGranted = false;
		if (requested === null) return;
		const release = acquireMediaLoadSlot(() => (slotGranted = true));
		releaseSlot = release;
		return () => {
			if (imageElement?.isConnected === false && !imageElement.complete)
				releaseWhenSettled({ image: imageElement, release });
			else release();
		};
	});
>>>>>>> origin/forgejo-sync
</script>

{#if pending || src === null}
	<Skeleton
		data-slot={pending ? "media-image-pending" : "empty-media"}
		role={alt === "" ? undefined : "img"}
		aria-label={alt === "" ? undefined : alt}
		class={["rounded-none", { "animate-none": !pending }, className]}
	/>
{:else if failedSrc !== src}
	<img
<<<<<<< HEAD
		src={deferred ? TRANSPARENT_PIXEL : src}
=======
		bind:this={imageElement}
		src={slotGranted ? src : (shownSrc ?? TRANSPARENT_PIXEL)}
>>>>>>> origin/forgejo-sync
		{alt}
		{loading}
		use:loadWhenVisible={deferred ? () => (armed = true) : undefined}
		draggable="false"
		class={["object-cover", className, imgClass]}
		style:aspect-ratio={aspectRatio}
		onerror={() => {
			if (!slotGranted) return;
			releaseSlot();
			failedSrc = src;
		}}
		onload={(event) => {
			const image = event.currentTarget;
			if (!(image instanceof HTMLImageElement)) return;
<<<<<<< HEAD
			if (image.src === TRANSPARENT_PIXEL) return;
			if (image.naturalWidth === 0) failedSrc = src;
			else onload?.(image);
=======
			if (!slotGranted || image.src === TRANSPARENT_PIXEL) return;
			releaseSlot();
			if (image.naturalWidth === 0) {
				failedSrc = src;
				return;
			}
			shownSrc = src;
			onload?.(image);
>>>>>>> origin/forgejo-sync
		}}
	/>
{:else}
	<BrokenMedia
		{tone}
		{size}
		class={className}
		aspectRatio={aspectRatio ?? fallbackAspectRatio}
		label={alt === "" ? undefined : alt}
	/>
{/if}
