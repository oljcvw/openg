<script lang="ts">
	import { CheckCircle, SpinnerGap, Warning } from "phosphor-svelte";

	import {
		apiHealthState,
		isProfileOnlyProtection,
	} from "$lib/api/api-health-state.svelte";

	const status = $derived(apiHealthState.status);
	const retrySeconds = $derived(apiHealthState.retrySeconds);
	const recovered = $derived(status?.phase === "recovered");
	const profileOnlyProtection = $derived(isProfileOnlyProtection(status));
	const message = $derived.by(() => {
		switch (status?.phase) {
			case "recovering":
				return profileOnlyProtection
					? "Server protection refused optional profile details. Open Grind paused profile loading."
					: "Server protection refused an API request. Open Grind paused requests while it recovers.";
			case "cooldown":
				return profileOnlyProtection
					? `Optional profile loading is paused. Checking again after ${retrySeconds ?? 0} seconds.`
					: status.reason === "protection"
						? `API requests are paused after server protection refused a request. Checking again after ${retrySeconds ?? 0} seconds.`
						: `API requests are paused after repeated server errors. Checking again after ${retrySeconds ?? 0} seconds.`;
			case "probing":
				return profileOnlyProtection
					? "Checking whether optional profile loading can resume."
					: "Checking whether API requests can resume.";
			case "recovered":
				return profileOnlyProtection
					? "Optional profile loading resumed."
					: "API requests resumed.";
			default:
				return "";
		}
	});
</script>

{#if status}
	<div
		class={[
			"fixed inset-x-2 z-150001 flex items-center gap-2 rounded-lg px-3 py-2 text-sm shadow-lg",
			recovered ? "bg-emerald-700 text-white" : "bg-amber-400 text-stone-950",
		]}
		style="top: calc(var(--safe-area-top) + 0.5rem)"
		role="status"
		aria-live="polite"
	>
		{#if recovered}
			<CheckCircle class="size-5 shrink-0" weight="fill" />
		{:else if status.phase === "cooldown"}
			<Warning class="size-5 shrink-0" weight="fill" />
		{:else}
			<SpinnerGap class="size-5 shrink-0 animate-spin" weight="bold" />
		{/if}
		<span>{message}</span>
	</div>
{/if}
