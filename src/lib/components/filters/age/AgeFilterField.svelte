<script lang="ts">
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Label } from "$lib/components/ui/label";
	import FilterField from "../FilterField.svelte";
	import {
		ageRangeLabel,
		type BrowseAgeScale,
		DEFAULT_BROWSE_AGE_SCALE,
		isCustomBrowseAgeScale,
	} from "../filters";
	import AgeFilterSlider from "./AgeFilterSlider.svelte";
	import BrowseAgeScaleNotice from "./BrowseAgeScaleNotice.svelte";

	let {
		checked = $bindable(),
		value = $bindable(),
		scale = DEFAULT_BROWSE_AGE_SCALE,
		onresetscale,
		onsettings,
	}: {
		checked: boolean;
		value: number[];
		scale?: BrowseAgeScale;
		onresetscale?: () => void | Promise<void>;
		onsettings?: () => void;
	} = $props();

	const label = $derived(ageRangeLabel(value));

	const uid = $props.id();
</script>

<div class="inline-block w-full space-y-3">
	<FilterField>
		<Checkbox id="filters-age-{uid}" bind:checked />
		<Label for="filters-age-{uid}">Age</Label>
		<span class="ml-auto min-w-0 truncate">
			{label}
		</span>
	</FilterField>
	<div class="ps-7">
		{#if isCustomBrowseAgeScale(scale) && onresetscale && onsettings}
			<div class="mb-3">
				<BrowseAgeScaleNotice {scale} onreset={onresetscale} {onsettings} />
			</div>
		{/if}
		<AgeFilterSlider
			min={scale.min}
			max={scale.max}
			bind:value={
				() => value,
				(v: number[]) => {
					checked = true;
					value = v;
				}
			}
		/>
	</div>
</div>
