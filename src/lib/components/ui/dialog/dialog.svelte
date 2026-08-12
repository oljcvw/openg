<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";

	import { backLayerManager } from "$lib/navigation/app-navigation";

	let { open = $bindable(false), ...restProps }: DialogPrimitive.RootProps =
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

<DialogPrimitive.Root bind:open {...restProps} />
