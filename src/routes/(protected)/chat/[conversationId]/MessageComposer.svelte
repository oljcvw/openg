<script lang="ts">
	import { expoOut } from "svelte/easing";
	import { fade } from "svelte/transition";
	import toast from "svelte-french-toast";
	import { MicrophoneIcon, PaperPlaneRightIcon } from "phosphor-svelte";
	import { Button } from "$lib/components/ui/button";
	import { Textarea } from "$lib/components/ui/textarea";

	let { onSend }: { onSend: (params: { text: string }) => Promise<void> } =
		$props();

	let textContent = $state("");

	async function onSubmit() {
		const text = textContent.trim();
		if (text === "") return;
		try {
			await onSend({ text });
			textContent = "";
		} catch (error) {
			console.error(error);
			toast.error("Failed to send message");
		}
	}
</script>

<form
	class="relative mx-2 shrink-0 min-h-9.5 min-w-0"
	onsubmit={(event) => {
		event.preventDefault();
		onSubmit().catch((error) => console.error(error));
	}}
>
	<Textarea
		aria-label="Message text"
		name="message"
		autocomplete="off"
		placeholder="Say something…"
		class="min-h-9.5 rounded-[20px] shrink-0 max-h-31.5 py-2 pr-9.5 h-fit! leading-5 placeholder-shown:truncate"
		onkeydown={(event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				event.currentTarget.form?.requestSubmit();
			}
		}}
		bind:value={textContent}
	/>
	{#if textContent === ""}
		<div class="button" transition:fade={{ duration: 400, easing: expoOut }}>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-full cursor-pointer p-2"
				onclick={() => {
					toast.error("TODO: Voice messages not implemented yet");
				}}
			>
				<MicrophoneIcon
					weight="fill"
					color="var(--muted-foreground)"
					class="size-4.5"
				/>
			</Button>
		</div>
	{:else}
		<div class="button" transition:fade={{ duration: 400, easing: expoOut }}>
			<Button
				type="submit"
				variant="ghost"
				size="icon"
				class="size-full cursor-pointer p-2"
			>
				<PaperPlaneRightIcon
					weight="fill"
					color="var(--primary)"
					class="size-4.5"
				/>
			</Button>
		</div>
	{/if}
</form>

<style lang="postcss">
	@reference "$layout";
	.button {
		@apply size-9.5 absolute bottom-0 right-0;
	}
</style>
