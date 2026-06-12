<script lang="ts">
	import StarIcon from "phosphor-svelte/lib/StarIcon";

	import * as Empty from "$lib/components/ui/empty";
</script>

<Empty.Root class="col-span-full">
	<Empty.Header>
		<Empty.Media variant="icon">
			<StarIcon weight="fill" />
		</Empty.Media>
		<Empty.Title>No favorites yet</Empty.Title>
		<Empty.Description>
			Profiles you star will appear here without affecting your browse filters.
		</Empty.Description>
	</Empty.Header>
</Empty.Root>
