<script lang="ts">
	import StarIcon from "phosphor-svelte/lib/StarIcon";

	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import LocationChooser from "../(root)/LocationEmpty.svelte";
	import FavoritesGrid from "./FavoritesGrid.svelte";

	let preferences = $state(getPreferences());
</script>

<svelte:head>
	<title>Favorites</title>
</svelte:head>

{#await preferences then { geohash }}
	{#if geohash === null}
		<main class="m-auto flex flex-1 max-w-full">
			<LocationChooser onUpdate={() => (preferences = getPreferences())} />
		</main>
	{:else}
		<main class="flex flex-1 flex-col p-4 gap-4">
			<header class="flex items-center gap-3 px-1">
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
			<FavoritesGrid {geohash} />
		</main>
	{/if}
{/await}
