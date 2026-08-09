<script lang="ts">
	import { Drawer as DrawerPrimitive } from "vaul-svelte";

	import { backLayerManager } from "$lib/navigation/app-navigation";

	let {
		shouldScaleBackground = true,
		open = $bindable(false),
		activeSnapPoint = $bindable(null),
		...restProps
	}: DrawerPrimitive.RootProps = $props();

	$effect(() => {
		if (!open) return;
		return backLayerManager.register({
			priority: "drawer",
			handler: () => {
				open = false;
				return "handled";
			},
		});
	});
</script>

<DrawerPrimitive.Root
	{shouldScaleBackground}
	bind:open
	bind:activeSnapPoint
	{...restProps}
/>
