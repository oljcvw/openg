<script lang="ts">
	import {
		getPersistedProfile,
		type ProfileSummary,
	} from "$lib/api/users/profiles";
	import { getUnitsSnapshot } from "$lib/app-data/preferences.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import {
		bodyTypes,
		ethnicities,
		type Profile,
		sexualPositions,
	} from "$lib/model/users/profiles";
	import { formatHeight, formatWeightGrams } from "$lib/util/units";

	let {
		profileId,
		summary = null,
		class: className,
	}: {
		profileId: number;
		summary?: ProfileSummary | null;
		class?: import("svelte/elements").ClassValue;
	} = $props();

	let cachedProfile: Profile | null = $state(null);
	const units = $derived(getUnitsSnapshot());

	$effect(() => {
		let current = true;
		const id = profileId;
		void getPersistedProfile(id)
			.then((profile) => {
				if (current && id === profileId) cachedProfile = profile;
			})
			.catch((error: unknown) => {
				console.error("Profile card cache lookup failed", error);
			});
		return () => {
			current = false;
		};
	});

	const facts = $derived.by(() => {
		const values: string[] = [];
		const sexualPosition =
			summary?.sexualPosition ?? cachedProfile?.sexualPosition;
		if (sexualPosition !== null && sexualPosition !== undefined) {
			values.push(sexualPositions[sexualPosition]);
		}
		if (summary?.showAge && summary.age !== null) {
			values.push(`${summary.age}`);
		} else if (cachedProfile?.showAge && cachedProfile.age !== null) {
			values.push(`${cachedProfile.age}`);
		}
		if (cachedProfile?.height !== null && cachedProfile?.height !== undefined) {
			values.push(formatHeight(cachedProfile.height, units));
		}
		if (cachedProfile?.weight !== null && cachedProfile?.weight !== undefined) {
			values.push(formatWeightGrams(cachedProfile.weight, units));
		}
		if (
			cachedProfile?.bodyType !== null &&
			cachedProfile?.bodyType !== undefined
		) {
			values.push(bodyTypes[cachedProfile.bodyType]);
		}
		if (
			cachedProfile?.ethnicity !== null &&
			cachedProfile?.ethnicity !== undefined
		) {
			values.push(ethnicities[cachedProfile.ethnicity]);
		}
		return values;
	});
</script>

{#if facts.length > 0}
	<div
		class={["min-w-0 flex-wrap gap-1", className]}
		aria-label="Profile details"
	>
		{#each facts as fact}
			<Badge variant="secondary" class="max-w-full truncate font-normal">
				{fact}
			</Badge>
		{/each}
	</div>
{/if}
