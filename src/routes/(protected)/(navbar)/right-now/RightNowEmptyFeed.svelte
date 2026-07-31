<script lang="ts">
	import DropIcon from "phosphor-svelte/lib/DropIcon";

	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { rightNowState } from "$lib/right-now/right-now-state.svelte";
</script>

<Empty.Root class="min-h-80">
	<Empty.Header>
		<Empty.Media variant="icon"><DropIcon /></Empty.Media>
		<Empty.Title>No posts found</Empty.Title>
		<Empty.Description>
			Try changing your filters or check again shortly.
		</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<Button
			variant="outline"
			onclick={() => rightNowState.filters.resetFilters()}
		>
			Reset filters
		</Button>
	</Empty.Content>
</Empty.Root>
