<script lang="ts">
	import { CameraIcon } from "phosphor-svelte";

	import * as Dialog from "$lib/components/ui/dialog";
	import ComposerCaptureActions from "./attachments/ComposerCaptureActions.svelte";
	import ComposerButton from "./ComposerButton.svelte";
	import { getMessageComposerContext } from "./message-composer-context.svelte";

	let open = $state(false);
	const { disabled } = $derived(getMessageComposerContext()());
</script>

<Dialog.Root bind:open>
	<ComposerButton
		class="left-0 rounded-s-composer ps-1.5"
		onclick={() => (open = true)}
		aria-label="Open camera"
		{disabled}
	>
		{#snippet icon({ ...props })}
			<CameraIcon weight="fill" {...props} class="size-5" />
		{/snippet}
	</ComposerButton>

	<Dialog.Content class="gap-3 p-4 sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Camera</Dialog.Title>
			<Dialog.Description>
				Take a photo or record a short video.
			</Dialog.Description>
		</Dialog.Header>
		<ComposerCaptureActions
			{disabled}
			onPhotoAdded={() => (open = false)}
			onClose={() => (open = false)}
		/>
	</Dialog.Content>
</Dialog.Root>
