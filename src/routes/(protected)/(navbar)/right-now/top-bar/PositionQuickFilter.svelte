<script lang="ts">
	import type z from "zod";

	import {
		defaultRightNowFilters,
		filterPositionSchema,
	} from "$lib/components/filters/filters";
	import PositionFilterToggle from "$lib/components/filters/position/PositionFilterToggle.svelte";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Switch } from "$lib/components/ui/switch";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";

	let { open = $bindable() }: { open: boolean } = $props();
	let enabled = $state(false);
	let value: z.infer<typeof filterPositionSchema> = $state([]);

	$effect(() => {
		if (!open) return;
		const current = rightNowState.filters.value ?? defaultRightNowFilters;
		enabled = current.positionEnabled;
		value = [...current.positions];
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
			<Button variant="link" onclick={() => (value = [])}>Reset</Button>
			<Drawer.Title>Positions</Drawer.Title>
			<Switch aria-label="Enable position filter" bind:checked={enabled} />
		</Drawer.Header>
		<div class="px-4">
			<PositionFilterToggle
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
					rightNowState.filters.set({
						positionEnabled: enabled,
						positions: value,
					})}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
