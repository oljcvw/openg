<script lang="ts">
	import { Label } from "$lib/components/ui/label";
	import { Textarea } from "$lib/components/ui/textarea";
	import { cn } from "$lib/util/utils";

	let {
		label,
		value = $bindable(),
		maxLength,
		placeholder,
		class: className,
	}: {
		label: string;
		value: string;
		maxLength: number;
		placeholder?: string;
		class?: string;
	} = $props();

	const remaining = $derived(maxLength - value.length);
	const over = $derived(remaining < 0);
</script>

<div class="flex flex-col gap-1.5">
	<Label class="px-1">{label}</Label>
	<Textarea
		bind:value
		{placeholder}
		aria-invalid={over}
		class={cn("min-h-24", className)}
	/>
	<div class="flex justify-between gap-2 px-1 text-xs">
		<span class={{ "text-destructive": over, invisible: !over }}>
			Too long, please shorten
		</span>
		<span
			class={[
				"tabular-nums",
				over ? "text-destructive" : "text-muted-foreground",
			]}
		>
			{remaining}
		</span>
	</div>
</div>
