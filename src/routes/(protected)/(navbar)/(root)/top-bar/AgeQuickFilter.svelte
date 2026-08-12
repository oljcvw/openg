<script lang="ts">
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import { getBrowseAgeScaleSnapshot } from "$lib/app-data/preferences.svelte";
	import AgeFilterSlider from "$lib/components/filters/age/AgeFilterSlider.svelte";
	import BrowseAgeScaleNotice from "$lib/components/filters/age/BrowseAgeScaleNotice.svelte";
	import {
		ageRangeLabel,
		clampAgeRange,
		defaultFilters,
		isCustomBrowseAgeScale,
	} from "$lib/components/filters/filters";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Switch } from "$lib/components/ui/switch";
	import { restoreDefaultBrowseAgeScale } from "$lib/grid/browse-age-scale";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";

	let {
		open = $bindable(),
	}: {
		open: boolean;
	} = $props();

	const ageScale = $derived(getBrowseAgeScaleSnapshot());
	let filters = $derived({ ...(gridState.filters.value ?? defaultFilters) });
	let { ageEnabled: enabled, age: value } = $derived(filters);

	$effect(() => {
		if (open) {
			filters = { ...(gridState.filters.value ?? defaultFilters) };
			value = clampAgeRange(filters.age, ageScale);
		}
	});

	$effect(() => {
		if (open) {
			const onBackGesture = () => {
				open = false;
				return false;
			};
			backGestureEventHandlers.add(onBackGesture);
			return () => {
				backGestureEventHandlers.delete(onBackGesture);
			};
		}
	});

	const label = $derived(ageRangeLabel(value));

	async function resetScale(): Promise<void> {
		try {
			await restoreDefaultBrowseAgeScale();
			toast.success("Browse age slider scale reset");
		} catch (error) {
			showErrorToast({ label: "Failed to reset Browse age scale", error });
		}
	}
</script>

<Drawer.Root bind:open handleOnly>
	<Drawer.Content
		handle={null}
		preventOverflowTextSelection={false}
		class="mx-auto max-w-160"
	>
		<Drawer.Header class="flex flex-row items-center justify-between">
			<div class="flex flex-1 justify-start">
				<Button
					variant="link"
					class="cursor-pointer"
					onclick={() => {
						value = [ageScale.min, ageScale.max];
					}}
				>
					Reset
				</Button>
			</div>
			<Drawer.Title>Age</Drawer.Title>
			<div class="flex flex-1 justify-end">
				<Switch aria-label="Filter by age" bind:checked={enabled} />
			</div>
		</Drawer.Header>
		<div class="mb-2 flex flex-col gap-1.5 px-4">
			<div class="mb-2 w-full text-center">{label}</div>
			{#if isCustomBrowseAgeScale(ageScale)}
				<div class="mb-2">
					<BrowseAgeScaleNotice
						scale={ageScale}
						onreset={resetScale}
						onsettings={() => (open = false)}
					/>
				</div>
			{/if}
			<AgeFilterSlider
				min={ageScale.min}
				max={ageScale.max}
				bind:value={
					() => value,
					(v: number[]) => {
						enabled = true;
						value = v;
					}
				}
			/>
		</div>
		<Drawer.Footer>
			<Drawer.Close
				class={buttonVariants({ variant: "default" })}
				onclick={() => {
					gridState.filters.set({
						ageEnabled: enabled,
						age: value,
					});
					open = false;
				}}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
