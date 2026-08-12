<script lang="ts">
	import { onDestroy, tick, untrack } from "svelte";
	import { toast } from "svelte-sonner";

	import { showErrorToast } from "$lib/api/error";
	import { getBrowseAgeScaleSnapshot } from "$lib/app-data/preferences.svelte";
	import {
		AGE_MAX,
		AGE_MIN,
		ageRangeLabel,
		type BrowseAgeScale,
		browseAgeScaleLabel,
	} from "$lib/components/filters/filters";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Input } from "$lib/components/ui/input";
	import * as Item from "$lib/components/ui/item";
	import { applyBrowseAgeScale } from "$lib/grid/browse-age-scale";

	type CorrectedField = "and-over" | "maximum" | "minimum";
	type Correction = { field: CorrectedField; message: string };

	const initial = untrack(getBrowseAgeScaleSnapshot);
	let minimum = $state(initial.min);
	let maximum = $state(initial.max);
	let saving = $state(false);
	let correctedFields = $state<CorrectedField[]>([]);
	let correctionAnnouncement = $state("");
	let correctionTimer: ReturnType<typeof setTimeout> | null = null;

	const andOver = $derived(maximum === AGE_MAX);
	const scaleLabel = $derived(
		browseAgeScaleLabel({ min: minimum, max: maximum }),
	);

	onDestroy(() => {
		if (correctionTimer !== null) clearTimeout(correctionTimer);
	});

	function readInteger(
		event: Event,
		bounds: { min: number; max: number },
		fallback: number,
	): number | null {
		const input = event.currentTarget as HTMLInputElement;
		const value = Number(input.value);
		if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
			input.value = String(fallback);
			return null;
		}
		return value;
	}

	async function showCorrections(corrections: Correction[]): Promise<void> {
		if (corrections.length === 0) return;
		if (correctionTimer !== null) clearTimeout(correctionTimer);
		correctedFields = [];
		correctionAnnouncement = "";
		await tick();
		correctedFields = corrections.map(({ field }) => field);
		correctionAnnouncement = corrections
			.map(({ message }) => message)
			.join(" ");
		correctionTimer = setTimeout(() => {
			correctedFields = [];
			correctionTimer = null;
		}, 1_100);
	}

	async function saveScale(
		nextScale: BrowseAgeScale,
		corrections: Correction[],
	): Promise<void> {
		const previous = { min: minimum, max: maximum };
		minimum = nextScale.min;
		maximum = nextScale.max;
		saving = true;
		try {
			const result = await applyBrowseAgeScale(nextScale);
			minimum = result.scale.min;
			maximum = result.scale.max;
			await showCorrections(corrections);
			if (result.ageSelectionClamped) {
				toast.info(
					`Browse age selection adjusted to ${ageRangeLabel(result.nextAge)}`,
				);
			}
		} catch (error) {
			minimum = previous.min;
			maximum = previous.max;
			showErrorToast({ label: "Failed to save Browse age scale", error });
		} finally {
			saving = false;
		}
	}

	function saveMinimum(event: Event): void {
		const nextMinimum = readInteger(
			event,
			{ min: AGE_MIN, max: AGE_MAX - 1 },
			minimum,
		);
		if (nextMinimum === null || nextMinimum === minimum) return;
		const nextMaximum = Math.max(maximum, nextMinimum);
		const corrections: Correction[] = [];
		if (nextMaximum !== maximum) {
			corrections.push({
				field: "maximum",
				message: `Maximum adjusted to ${nextMaximum} to match minimum.`,
			});
		}
		void saveScale({ min: nextMinimum, max: nextMaximum }, corrections);
	}

	function saveMaximum(event: Event): void {
		const nextMaximum = readInteger(
			event,
			{ min: AGE_MIN, max: AGE_MAX },
			maximum,
		);
		if (nextMaximum === null || nextMaximum === maximum) return;
		const nextMinimum = Math.min(minimum, nextMaximum);
		const corrections: Correction[] = [];
		if (nextMinimum !== minimum) {
			corrections.push({
				field: "minimum",
				message: `Minimum adjusted to ${nextMinimum} to match maximum.`,
			});
		}
		if ((maximum === AGE_MAX) !== (nextMaximum === AGE_MAX)) {
			corrections.push({
				field: "and-over",
				message:
					nextMaximum === AGE_MAX
						? "And over enabled for maximum 102."
						: "And over disabled below maximum 102.",
			});
		}
		void saveScale({ min: nextMinimum, max: nextMaximum }, corrections);
	}

	function setAndOver(checked: boolean): void {
		const nextMaximum = checked ? AGE_MAX : AGE_MAX - 1;
		if (nextMaximum === maximum) return;
		void saveScale({ min: Math.min(minimum, nextMaximum), max: nextMaximum }, [
			{
				field: "maximum",
				message: checked
					? `Maximum adjusted to ${AGE_MAX} for And over.`
					: `Maximum adjusted to ${AGE_MAX - 1} because And over was disabled.`,
			},
		]);
	}
</script>

<Item.Root variant="outline" class="gap-4 p-4">
	<Item.Content class="w-full gap-1">
		<Item.Title>Browse age slider scale</Item.Title>
		<Item.Description class="line-clamp-none">
			Limit the ages covered by Browse sliders without changing their width. The
			full recommended scale is 18 through And over.
		</Item.Description>
	</Item.Content>
	<div class="grid w-full gap-3 sm:grid-cols-2">
		<label class="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
			Minimum
			<div
				class:correction-feedback={correctedFields.includes("minimum")}
				class="rounded-3xl"
			>
				<Input
					type="number"
					min={AGE_MIN}
					max={AGE_MAX - 1}
					disabled={saving}
					value={String(minimum)}
					onchange={saveMinimum}
				/>
			</div>
		</label>
		<label class="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
			Maximum
			<div
				class:correction-feedback={correctedFields.includes("maximum")}
				class="rounded-3xl"
			>
				<Input
					type="number"
					min={AGE_MIN}
					max={AGE_MAX}
					disabled={saving}
					value={String(maximum)}
					onchange={saveMaximum}
				/>
			</div>
		</label>
	</div>
	<div class="flex w-full flex-wrap items-center justify-between gap-3">
		<label
			class:correction-feedback={correctedFields.includes("and-over")}
			class="flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm font-medium"
		>
			<Checkbox disabled={saving} bind:checked={() => andOver, setAndOver} />
			And over
		</label>
		<span class="text-sm text-muted-foreground"
			>Current scale: {scaleLabel}</span
		>
	</div>
	<p class="sr-only" aria-live="polite">{correctionAnnouncement}</p>
</Item.Root>

<style>
	.correction-feedback {
		animation: correction-surface 1.1s ease-out;
	}

	.correction-feedback :global([data-slot="input"]),
	.correction-feedback :global([data-slot="checkbox"]) {
		animation: correction-control 1.1s ease-out;
	}

	@keyframes correction-surface {
		0%,
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
		15% {
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 35%, transparent);
		}
	}

	@keyframes correction-control {
		0%,
		100% {
			color: inherit;
		}
		15% {
			color: var(--primary);
			filter: brightness(1.18);
		}
	}

	:global(:root[data-contrast="high"]) .correction-feedback {
		outline: 2px solid var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.correction-feedback,
		.correction-feedback :global([data-slot="input"]),
		.correction-feedback :global([data-slot="checkbox"]) {
			animation: none;
		}

		.correction-feedback {
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 35%, transparent);
		}
	}
</style>
