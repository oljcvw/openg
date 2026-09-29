<script lang="ts">
	import type { LoadedEntry } from "$lib/credits";
	import BlurbText from "./BlurbText.svelte";
	import LicenseDisclosure from "./LicenseDisclosure.svelte";

	let { entry }: { entry: LoadedEntry } = $props();
</script>

<<<<<<< HEAD
<div class="flex min-w-0 flex-col gap-0.5 px-1 py-1.5" data-slot="credit-row">
=======
<div
	class="flex min-w-0 flex-col gap-0.5 px-1 py-1.5"
	data-slot="credit-row"
	data-offscreen-skip
	style:--offscreen-block-size="3.4375rem"
>
>>>>>>> origin/forgejo-sync
	<BlurbText name={entry.name} url={entry.url} />
	<LicenseDisclosure {entry} />
</div>
