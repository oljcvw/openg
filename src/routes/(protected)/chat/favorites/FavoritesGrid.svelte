<script lang="ts">
	import { uniqBy } from "lodash-es";

	import ApiErrorDisplay from "$lib/components/ApiErrorDisplay.svelte";
	import GridProfileMiniCard from "../../(navbar)/(root)/GridProfileMiniCard.svelte";
	import EmptyFavorites from "./EmptyFavorites.svelte";
	import { favoritesGridState } from "./favorites-grid-state.svelte";

	let {
		geohash,
		scrollContainer = null,
	}: {
		geohash: string;
		scrollContainer?: HTMLDivElement | null;
	} = $props();

	const gridProfiles = $derived(uniqBy(favoritesGridState.items, "id"));

	$effect.pre(() => {
		favoritesGridState.load(geohash);
	});

	$effect(() => {
		const target = scrollContainer ?? window;
		const saveScroll = () => {
			favoritesGridState.scrollY = scrollContainer?.scrollTop ?? window.scrollY;
		};
		target.addEventListener("scroll", saveScroll, { passive: true });
		return () => target.removeEventListener("scroll", saveScroll);
	});

	let scrolled = $state(false);
	$effect(() => {
		if (
			!scrolled &&
			!favoritesGridState.loading &&
			favoritesGridState.errorMessage === null
		) {
			scrolled = true;
			if (scrollContainer) {
				scrollContainer.scrollTop = favoritesGridState.scrollY;
			} else {
				window.scrollTo({ top: favoritesGridState.scrollY, behavior: "instant" });
			}
		}
	});

	function observeSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting)
					favoritesGridState
						.loadMore()
						.catch((error) => console.error(error));
			},
			{ root: scrollContainer, rootMargin: "400px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}

	function observePartial(node: HTMLElement, params: { batchIndex: number }) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					favoritesGridState
						.loadBatch(params.batchIndex)
						.catch((error) => console.error(error));
					observer.disconnect();
				}
			},
			{ root: scrollContainer, rootMargin: "200px" },
		);
		observer.observe(node);
		return {
			destroy() {
				observer.disconnect();
			},
		};
	}
</script>

<div class="profile-grid">
	{#if favoritesGridState.loading}
		{#each Array.from({ length: 20 })}
			<div class="aspect-square bg-stone-700 animate-pulse"></div>
		{/each}
	{:else if favoritesGridState.error}
		<div class="p-4 flex col-span-full">
			<ApiErrorDisplay
				error={favoritesGridState.error}
				onRetry={() => favoritesGridState.refresh()}
				class="m-auto"
			/>
		</div>
	{:else}
		{#each gridProfiles as item (item.id)}
			{#if item.type === "full"}
				<GridProfileMiniCard
					id={item.id}
					displayName={item.displayName}
					distance={item.distance}
					unread={item.unread}
					onlineUntil={item.onlineUntil}
					isFavorite={item.isFavorite}
					hadRecentChat={item.hasChattedInLast24Hrs}
					medias={item.profilePhotosHashes?.map((mediaHash) => ({
						mediaHash,
					})) ?? []}
				/>
			{:else}
				<div
					class="aspect-square bg-stone-700 animate-pulse"
					use:observePartial={{ batchIndex: item.batchIndex }}
				></div>
			{/if}
		{:else}
			<EmptyFavorites />
		{/each}
		{#if favoritesGridState.loadingMore}
			{#each Array.from({ length: 20 })}
				<div class="aspect-square bg-stone-700 animate-pulse"></div>
			{/each}
		{/if}
		{#if favoritesGridState.nextPage !== 0 && favoritesGridState.nextPage !== null}
			<div class="col-span-full h-0" use:observeSentinel></div>
		{/if}
	{/if}
</div>
