<script lang="ts">
	import NavBar from "$lib/components/NavBar.svelte";
	import DesktopSidebar from "$lib/components/DesktopSidebar.svelte";

	let { children, data }: import("./$types").LayoutProps = $props();
</script>

<div class="flex min-h-dvh">
	<DesktopSidebar ourProfileId={data.ourProfileId} />
	<div class="min-w-0 flex-1">
		{@render children?.()}
	</div>
</div>
<NavBar ourProfileId={data.ourProfileId} />
