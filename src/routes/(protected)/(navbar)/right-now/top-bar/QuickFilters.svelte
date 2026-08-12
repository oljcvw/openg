<script lang="ts">
	import { defaultRightNowFilters } from "$lib/components/filters/filters";
	import { Button } from "$lib/components/ui/button";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
	import AgeQuickFilter from "./AgeQuickFilter.svelte";
	import HostingQuickFilter from "./HostingQuickFilter.svelte";
	import PositionQuickFilter from "./PositionQuickFilter.svelte";
	import SortQuickFilter from "./SortQuickFilter.svelte";

	let {
		openFilters = $bindable(),
	}: {
		openFilters: {
			sort: boolean;
			age: boolean;
			position: boolean;
			hosting: boolean;
		};
	} = $props();

	const filters = $derived(
		rightNowState.filters.value ?? defaultRightNowFilters,
	);
	const hostingLabel = $derived(
		filters.hosting === null
			? "Hosting"
			: filters.hosting
				? "Hosting: Yes"
				: "Hosting: No",
	);
</script>

<Button
	variant="secondary"
	onclick={() => (openFilters.sort = true)}
	class={{ "bg-white text-popover": filters.sort === "NEWEST" }}
>
	{filters.sort === "NEWEST" ? "Recent" : "Distance"}
</Button>
<Button
	variant="secondary"
	onclick={() => (openFilters.age = true)}
	class={{ "bg-white text-popover": filters.ageEnabled }}
>
	Age
</Button>
<Button
	variant="secondary"
	onclick={() => (openFilters.position = true)}
	class={{ "bg-white text-popover": filters.positionEnabled }}
>
	Position
</Button>
<Button
	variant="secondary"
	onclick={() => (openFilters.hosting = true)}
	class={{ "bg-white text-popover": filters.hosting !== null }}
>
	{hostingLabel}
</Button>

<SortQuickFilter bind:open={openFilters.sort} />
<AgeQuickFilter bind:open={openFilters.age} />
<PositionQuickFilter bind:open={openFilters.position} />
<HostingQuickFilter bind:open={openFilters.hosting} />
