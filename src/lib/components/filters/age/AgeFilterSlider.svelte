<script lang="ts">
	import { Slider } from "$lib/components/ui/slider";
	import { AGE_MAX, AGE_MIN } from "../filters";

	let {
		value = $bindable(),
		min = AGE_MIN,
		max = AGE_MAX,
	}: { value: number[]; min?: number; max?: number } = $props();
</script>

<Slider
	type="multiple"
	bind:value
	{min}
	{max}
	step={1}
	thumbAriaLabels={["Minimum age", "Maximum age"]}
	thumbAriaValueText={(thumbValue, index) =>
		index === 1 && thumbValue === AGE_MAX ? "And over" : `${thumbValue}`}
/>
