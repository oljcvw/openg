<script lang="ts">
	import AgeFilterSlider from "$lib/components/filters/age/AgeFilterSlider.svelte";
	import {
		ageRangeLabel,
		defaultRightNowFilters,
	} from "$lib/components/filters/filters";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Switch } from "$lib/components/ui/switch";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";

	let { open = $bindable() }: { open: boolean } = $props();
	let enabled = $state(false);
	let value = $state([...defaultRightNowFilters.age]);
	const label = $derived(ageRangeLabel(value));

	$effect(() => {
		if (!open) return;
		const current = rightNowState.filters.value ?? defaultRightNowFilters;
		enabled = current.ageEnabled;
		value = [...current.age];
		const close = () => {
			open = false;
			return false;
		};
		backGestureEventHandlers.add(close);
		return () => backGestureEventHandlers.delete(close);
	});
</script>

<Drawer.Root bind:open>
	<Drawer.Content class="mx-auto max-w-160">
		<Drawer.Header class="flex-row items-center justify-between">
			<Button
				variant="link"
				onclick={() => (value = [...defaultRightNowFilters.age])}
			>
				Reset
			</Button>
			<Drawer.Title>Age</Drawer.Title>
			<Switch aria-label="Enable age filter" bind:checked={enabled} />
		</Drawer.Header>
		<div class="space-y-3 px-4">
			<p class="text-center">{label}</p>
			<AgeFilterSlider
				bind:value={
					() => value,
					(next) => {
						enabled = true;
						value = next;
					}
				}
			/>
		</div>
		<Drawer.Footer>
			<Drawer.Close
				class={buttonVariants({ variant: "default" })}
				onclick={() =>
					rightNowState.filters.set({ ageEnabled: enabled, age: value })}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
