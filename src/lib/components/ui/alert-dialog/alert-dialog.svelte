<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";

	import { backLayerManager } from "$lib/navigation/app-navigation";

	let {
		open = $bindable(false),
		...restProps
	}: AlertDialogPrimitive.RootProps = $props();

	$effect(() => {
		if (!open) return;
		return backLayerManager.register({
			priority: "dialog",
			handler: () => {
				open = false;
				return "handled";
			},
		});
	});
</script>

<AlertDialogPrimitive.Root bind:open {...restProps} />
