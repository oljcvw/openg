<script lang="ts">
	import { CaretDownIcon, CaretUpIcon, XIcon } from "phosphor-svelte";

	import { Button } from "$lib/components/ui/button";
	import type { VoiceNoteNavigatorState } from "$lib/chat/voice-note-navigator.svelte";

	let {
		state,
		onOlder,
		onNewer,
		onExit,
	}: {
		state: VoiceNoteNavigatorState;
		onOlder: () => void;
		onNewer: () => void;
		onExit: () => void;
	} = $props();

	const overlayBottom =
		"calc(var(--chat-ime-offset, 0px) + var(--composer-height) + 0.75rem)";
</script>

<div
	data-voice-note-interactive
	class="absolute right-3 z-3 flex items-center gap-1 rounded-full border bg-background/90 p-1 shadow-md backdrop-blur-xl"
	style:bottom={overlayBottom}
	role="toolbar"
	aria-label="Voice note navigation"
>
	<Button
		variant="ghost"
		size="icon"
		aria-label="Previous voice note"
		disabled={state.selectedIndex <= 0}
		onclick={onOlder}
	>
		<CaretUpIcon />
	</Button>
	<span class="min-w-14 text-center text-xs font-medium" aria-live="polite">
		{state.ordinal ?? "Voice note"}
	</span>
	<Button
		variant="ghost"
		size="icon"
		aria-label="Next voice note"
		disabled={state.selectedIndex >= state.keys.length - 1}
		onclick={onNewer}
	>
		<CaretDownIcon />
	</Button>
	<Button
		variant="ghost"
		size="icon"
		aria-label="Exit voice note navigation"
		onclick={onExit}
	>
		<XIcon />
	</Button>
</div>
