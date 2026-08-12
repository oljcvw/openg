<script lang="ts">
	import { setMessageContext, setMessageMetaContext } from "./context";
	import RichMessageCard from "./RichMessageCard.svelte";

	let { href }: { href: string } = $props();

	setMessageContext(() => ({
		firstInStack: true,
		lastInStack: false,
		indexInStack: 0,
		isOut: false,
		timestamp: 0,
	}));
	setMessageMetaContext(() => ({
		clone: false,
		setRef: () => {},
	}));
</script>

<RichMessageCard title="Shared album" {href} />
