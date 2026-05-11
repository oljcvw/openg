<script lang="ts">
	import "photoswipe/style.css";
	import z from "zod";
	import { format } from "date-fns";
	import { UserIcon } from "phosphor-svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";
	import ImageCarouselItem from "./ImageCarouselItem.svelte";

	let {
		medias,
	}: {
		medias: {
			mediaHash: string;
			takenOnGrindr: boolean | null;
			createdAt: number | null;
		}[];
	} = $props();

	let gallery: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (!gallery) return;
		let lightbox: PhotoSwipeLightbox | undefined;
		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				if (!gallery) return;
				const galleryElement = gallery;
				const currentLightbox = new PhotoSwipeLightbox({
					gallery: galleryElement,
					children: ".item",
					pswpModule: () => import("photoswipe"),
					mainClass: `pswp--buttons-visible`,
				});
				lightbox = currentLightbox;
				currentLightbox.addFilter("itemData", (itemData) => {
					const img = itemData.element?.querySelector("img");
					if (img?.naturalWidth) {
						itemData.width = img.naturalWidth;
						itemData.height = img.naturalHeight;
					}
					return itemData;
				});
				currentLightbox.on("openingAnimationStart", () => {
					galleryElement.querySelectorAll(".item").forEach((item) => {
						if (item instanceof HTMLElement) {
							item.style.visibility = "hidden";
						}
					});
				});

				currentLightbox.on("change", () => {
					galleryElement.scrollTo({
						top: currentLightbox.pswp?.currSlide?.data.element?.offsetTop ?? 0,
						behavior: "instant",
					});
				});

				currentLightbox.on("destroy", () => {
					galleryElement.querySelectorAll(".item").forEach((item) => {
						if (item instanceof HTMLElement) {
							item.style.visibility = "visible";
						}
					});
				});
				currentLightbox.on("uiRegister", () => {
					currentLightbox.pswp?.ui?.registerElement({
						name: "created-at-label",
						order: 9,
						appendTo: "root",
						onInit(element, pswp) {
							setTimeout(() => {
								const { data: createdAt } = z.coerce
									.number()
									.int()
									.safeParse(pswp.currSlide?.data.element?.dataset.createdAt);
								if (createdAt !== undefined) {
									element.textContent = format(createdAt, "dd MMMM yyyy");
								}
							}, 0);
						},
					});
				});

				currentLightbox.init();
			})
			.catch((error) => console.error(error));
		return () => lightbox?.destroy();
	});

	const GAP = 4; //px
	const PADDING_VERTICAL = 8; //px
	const PADDING_HORIZONTAL = PADDING_VERTICAL;
	const BULLET_SIZE = 8; //px

	let indicatorY = $state(PADDING_VERTICAL);
	let indicatorHeight = $state(BULLET_SIZE);
</script>

<div class="w-full h-auto aspect-3/4 max-h-[min(70vh,500px)] relative">
	{#if medias.length}
		<div
			class="size-full max-h-[inherit] flex flex-col snap-y snap-mandatory *:snap-center overflow-auto carousel relative"
			bind:this={gallery}
			onscroll={() => {
				if (!gallery) return;
				const item = gallery.scrollTop / gallery.clientHeight;
				const frac = item % 1;
				const stretch = Math.min(frac, 1 - frac);
				const index = Math.floor(item);
				const tipYp =
					Math.min(item > 0 ? index : item, medias.length - 1) +
					(item < medias.length - 1 ? Math.max(0, (frac - 0.5) * 2) : frac);
				indicatorY = PADDING_VERTICAL + tipYp * (BULLET_SIZE + GAP);
				const indicatorStretch = stretch * (BULLET_SIZE * 2 + GAP + 4);
				indicatorHeight =
					BULLET_SIZE +
					(item > 0 && item < medias.length - 1 ? indicatorStretch : 0);
			}}
		>
			{#each medias as { mediaHash, createdAt }}
				<ImageCarouselItem
					src="https://cdns.grindr.com/images/profile/1024x1024/{mediaHash}"
					thumb="https://cdns.grindr.com/images/profile/1024x1024/{mediaHash}"
					{createdAt}
				/>
			{/each}
		</div>
		<div
			class="absolute right-2 top-1/2 -translate-y-1/2 p-2 backdrop-blur-sm bg-background/30 rounded-full flex flex-col"
			style:gap="{GAP}px"
			style:padding="{PADDING_VERTICAL}px {PADDING_HORIZONTAL}px"
		>
			{#each medias as _, i (i)}
				<span class="bg-neutral-200/40 size-2 block rounded-full"></span>
			{/each}
			<span
				class="absolute left-2 bg-neutral-300 w-2 block rounded-full"
				style="top: {indicatorY}px; height: {BULLET_SIZE}px"
				style:height="{indicatorHeight}px"
			></span>
		</div>
	{:else}
		<div class="bg-neutral-700 size-full absolute">
			<UserIcon
				weight="fill"
				color="var(--color-stone-400)"
				class="size-3/4 top-1/2 left-1/2 -translate-1/2 absolute"
			/>
		</div>
	{/if}
</div>

<style lang="postcss">
	@reference "$layout";
	.carousel::-webkit-scrollbar {
		display: none;
	}
	:global {
		.pswp .pswp__button {
			display: none;
		}
		.pswp .pswp__created-at-label {
			text-shadow: 1px 1px 3px var(--pswp-icon-color-secondary);
			@apply absolute bottom-0 left-1/2 -translate-x-1/2 text-white/90 font-medium w-full h-16 flex justify-center items-center bg-linear-to-t from-background/60 pt-4;
		}
	}
</style>
