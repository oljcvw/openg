<script lang="ts">
	import AlbumEditor from "../../../../../albums/[albumId]/+page.svelte";

	let { data }: import("./$types").PageProps = $props();
</script>

<AlbumEditor {data} />
