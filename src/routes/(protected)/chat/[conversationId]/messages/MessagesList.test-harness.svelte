<script lang="ts">
	import { setConversationState } from "../conversation-state.svelte";
	import MessagesList from "./MessagesList.svelte";

	let {
		state: conversation,
		scrollToMessageId = null,
		onScrolled = () => {},
		readReportingEnabled = true,
	}: {
		state: unknown;
		scrollToMessageId?: string | null;
		onScrolled?: (result: boolean) => void;
		readReportingEnabled?: boolean;
	} = $props();

	setConversationState(() => conversation as never);

	let seenTimestamp = $state(0);
	let container: HTMLDivElement | null = $state(null);
	let messagesList:
		| { scrollToMessage: (messageId: string) => Promise<boolean> }
		| undefined = $state();

	$effect(() => {
		const messageId = scrollToMessageId;
		const list = messagesList;
		if (!messageId || !list) return;
		void list.scrollToMessage(messageId).then(onScrolled);
	});

	function mockViewport(node: HTMLDivElement) {
		Object.defineProperties(node, {
			clientHeight: { configurable: true, value: 800 },
			clientWidth: { configurable: true, value: 420 },
			offsetHeight: { configurable: true, value: 800 },
			offsetWidth: { configurable: true, value: 420 },
		});
	}
</script>

<div
	bind:this={container}
	use:mockViewport
	style="height: 800px; width: 420px; overflow: auto"
>
	<MessagesList
		{container}
		{readReportingEnabled}
		bind:seenTimestamp
		bind:this={messagesList}
	/>
</div>
