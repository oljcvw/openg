<script lang="ts">
	import {
		defaultRightNowFilters,
		type RightNowFilters,
	} from "$lib/components/filters/filters";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";

	let { open = $bindable() }: { open: boolean } = $props();
	let value: RightNowFilters["sort"] = $state("DISTANCE");

	$effect(() => {
		if (open)
			value = (rightNowState.filters.value ?? defaultRightNowFilters).sort;
	});
	$effect(() => {
		if (!open) return;
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
		<Drawer.Header><Drawer.Title>Sort posts</Drawer.Title></Drawer.Header>
		<fieldset class="grid gap-2 px-4">
			<legend class="sr-only">Sort posts by</legend>
			{#each [["DISTANCE", "Distance"], ["NEWEST", "Most recent"]] as option}
				<label
					class={[
						buttonVariants({ variant: "outline" }),
						"justify-start",
						{ "border-primary bg-muted": value === option[0] },
					]}
				>
					<input
						class="sr-only"
						type="radio"
						name="right-now-sort"
						value={option[0]}
						checked={value === option[0]}
						onchange={() => (value = option[0] as RightNowFilters["sort"])}
					/>
					{option[1]}
				</label>
			{/each}
		</fieldset>
		<Drawer.Footer>
			<Drawer.Close
				class={buttonVariants({ variant: "default" })}
				onclick={() => rightNowState.filters.set({ sort: value })}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
