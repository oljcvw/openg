<script lang="ts">
	import { MagnifyingGlassIcon } from "phosphor-svelte";

	import * as Empty from "$lib/components/ui/empty";

	let { query }: { query: string } = $props();
</script>

<Empty.Root>
	<Empty.Header>
		<Empty.Media variant="icon">
			<MagnifyingGlassIcon weight="bold" />
		</Empty.Media>
		<Empty.Title role="heading" aria-level={2}>
			No matching conversations
		</Empty.Title>
		<Empty.Description>
			No names or messages match “{query.trim()}”.
		</Empty.Description>
	</Empty.Header>
</Empty.Root>
