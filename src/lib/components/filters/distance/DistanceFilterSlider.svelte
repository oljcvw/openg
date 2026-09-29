<script lang="ts">
<<<<<<< HEAD
	import { getPreferencesSnapshot } from "$lib/app-data/preferences.svelte";
=======
	import { preferencesSnapshot } from "$lib/app-data/preferences.svelte";
>>>>>>> origin/forgejo-sync
	import { Slider } from "$lib/components/ui/slider";
	import { MAX_DISTANCE_STEPS, maxDistanceLabel } from "./distance-steps";

	let { value = $bindable() }: { value: number } = $props();

<<<<<<< HEAD
	const units = $derived(getPreferencesSnapshot().units);
=======
	const units = $derived(preferencesSnapshot().units);
>>>>>>> origin/forgejo-sync
	const index = $derived(MAX_DISTANCE_STEPS.indexOf(value));
</script>

<Slider
	type="single"
	min={0}
	max={MAX_DISTANCE_STEPS.length - 1}
	step={1}
	thumbLabels={["Maximum distance"]}
	thumbValueTexts={[maxDistanceLabel({ step: value, units })]}
	bind:value={
		() => index,
		(next: number) => (value = MAX_DISTANCE_STEPS[next] ?? value)
	}
/>
