<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";

	import { backLayerManager } from "$lib/navigation/app-navigation";

	let { open = $bindable(false), ...restProps }: SheetPrimitive.RootProps =
		$props();

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

<SheetPrimitive.Root bind:open {...restProps} />
