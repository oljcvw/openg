<script lang="ts">
	import type { TapType } from "$lib/model/interest/taps";
	import ProfileMessageComposer from "./ProfileMessageComposer.svelte";
	import TapProfileButton from "./TapProfileButton.svelte";

	let {
		ourProfileId,
		profileId,
		dismissOffsetY = 0,
		dismissSettling = false,
		dismissClosing = false,
		tapType,
		onTap,
	}: {
		ourProfileId: number;
		profileId: number;
		dismissOffsetY?: number;
		dismissSettling?: boolean;
		dismissClosing?: boolean;
		tapType: TapType | null;
		onTap: (tapType: TapType | null) => void;
	} = $props();

	const isOurProfile = $derived(profileId === ourProfileId);
</script>

{#if !isOurProfile}
	<div
		class={[
			"fixed bottom-[calc(0.5rem+var(--safe-area-bottom)+var(--nav-height))] left-1/2 z-40 w-90.5 max-w-full px-2 will-change-transform",
			{
				"transition-[transform,opacity] motion-reduce:transition-none":
					dismissSettling,
			},
		]}
		style:opacity={dismissClosing ? 0 : 1}
		style:transform={`translate3d(-50%, ${dismissOffsetY}px, 0)`}
		style:transition-duration={dismissClosing ? "220ms" : "170ms"}
		style:transition-timing-function="cubic-bezier(0.2, 0.85, 0.25, 1)"
	>
		<nav
			class="flex flex-row items-center gap-2 rounded-full bg-muted p-2 shadow-xl backdrop-blur-lg"
		>
			<ProfileMessageComposer {profileId} {ourProfileId} />
			<TapProfileButton {profileId} {tapType} {onTap} />
		</nav>
	</div>
{/if}
