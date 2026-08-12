<script lang="ts">
	import {
		type BrowseAgeScale,
		browseAgeScaleLabel,
	} from "$lib/components/filters/filters";
	import { Button } from "$lib/components/ui/button";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";

	let {
		scale,
		onreset,
		onsettings,
	}: {
		scale: BrowseAgeScale;
		onreset: () => void | Promise<void>;
		onsettings: () => void;
	} = $props();

	let resetting = $state(false);

	async function reset(): Promise<void> {
		resetting = true;
		try {
			await onreset();
		} finally {
			resetting = false;
		}
	}
</script>

<div
	class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl bg-muted/70 px-3 py-2 text-center text-xs text-muted-foreground in-data-[contrast=high]:border in-data-[contrast=high]:border-primary"
>
	<span>Slider scale limited to {browseAgeScaleLabel(scale)}</span>
	<Button
		href="/settings/developer"
		variant="link"
		size="xs"
		class="h-auto px-0"
		onclick={(event) =>
			interceptAppNavigationClick(event, () => {
				onsettings();
				return openAppDetail("/settings/developer");
			})}
	>
		Developer Settings
	</Button>
	<span aria-hidden="true">·</span>
	<Button
		variant="link"
		size="xs"
		class="h-auto px-0"
		disabled={resetting}
		onclick={() => void reset()}
	>
		Reset scale
	</Button>
</div>
