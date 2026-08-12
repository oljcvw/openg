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
	let value: RightNowFilters["hosting"] = $state(null);
	const options = [
		{ value: null, label: "Any hosting status" },
		{ value: true, label: "Hosting" },
		{ value: false, label: "Not hosting" },
	] as const;

	$effect(() => {
		if (open)
			value = (rightNowState.filters.value ?? defaultRightNowFilters).hosting;
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
		<Drawer.Header><Drawer.Title>Hosting status</Drawer.Title></Drawer.Header>
		<fieldset class="grid gap-2 px-4">
			<legend class="sr-only">Filter by hosting status</legend>
			{#each options as option}
				<label
					class={[
						buttonVariants({ variant: "outline" }),
						"justify-start",
						{ "border-primary bg-muted": value === option.value },
					]}
				>
					<input
						class="sr-only"
						type="radio"
						name="right-now-hosting"
						checked={value === option.value}
						onchange={() => (value = option.value)}
					/>
					{option.label}
				</label>
			{/each}
		</fieldset>
		<Drawer.Footer>
			<Drawer.Close
				class={buttonVariants({ variant: "default" })}
				onclick={() => rightNowState.filters.set({ hosting: value })}
			>
				Apply
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
