<script lang="ts">
	import StarIcon from "phosphor-svelte/lib/StarIcon";

	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "../../(navbar)/(root)/LocationEmpty.svelte";
	import InboxSubnav from "../InboxSubnav.svelte";
	import FavoritesGrid from "./FavoritesGrid.svelte";

	let preferences = $state(getPreferences());
	let scrollContainer: HTMLDivElement | null = $state(null);
</script>

<svelte:head>
	<title>Favorites</title>
</svelte:head>

{#await preferences then { geohash }}
	<main class="flex min-h-0 flex-1 flex-col">
		<div class="p-4 pb-3">
			<InboxSubnav />
		</div>
		{#if geohash === null}
			<div class="flex flex-1 px-4 pb-4">
				<LocationChooser onUpdate={() => (preferences = getPreferences())} />
			</div>
		{:else}
			<div bind:this={scrollContainer} class="flex-1 overflow-auto px-4 pb-4">
				<div class="flex min-h-full flex-col gap-4">
					<header class="flex items-center gap-3 px-1 pt-1">
						<div
							class="flex size-10 items-center justify-center rounded-full bg-input/50"
						>
							<StarIcon weight="fill" class="size-5 text-yellow-500" />
						</div>
						<div class="min-w-0">
							<h1 class="text-xl font-semibold tracking-tight">Favorites</h1>
							<p class="text-sm text-muted-foreground">
								Saved profiles without changing your browse filters.
							</p>
						</div>
					</header>
					<FavoritesGrid {geohash} {scrollContainer} />
				</div>
			</div>
		{/if}
	</main>
{/await}
