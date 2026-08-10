<script lang="ts">
	import { version } from "$app/environment";
	import { tick } from "svelte";

	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import { registerRootActivationRefresh } from "$lib/navigation/app-navigation";
	import {
		captureScrollAnchor,
		captureScrollNeighborhood,
		navigationMemory,
		restoreScrollAnchor,
	} from "$lib/navigation/navigation-memory";
	import AccountSettingsLink from "./AccountSettingsLink.svelte";
	import AppSettingsLink from "./AppSettingsLink.svelte";
	import DeveloperSettingsLink from "./DeveloperSettingsLink.svelte";
	import ManageAlbumsLink from "./ManageAlbumsLink.svelte";
	import ProfileLink from "./ProfileLink.svelte";
	import SignOutButton from "./SignOutButton.svelte";
	import Socials from "./Socials.svelte";

	const { data }: import("./$types").PageProps = $props();
	const accountSession = getAccountSessionSnapshot();
	let container: HTMLDivElement | null = $state(null);
	let scrollRestored = false;

	$effect(() =>
		registerRootActivationRefresh("/settings", () => {
			navigationMemory.clearSurfaceAnchor("settings", accountSession);
			container?.scrollTo({ top: 0, behavior: "instant" });
		}),
	);

	$effect(() => {
		if (scrollRestored || !container) return;
		scrollRestored = true;
		const el = container;
		const position = navigationMemory.getSurfaceScrollPosition(
			"settings",
			accountSession,
		);
		if (position)
			void tick().then(() =>
				restoreScrollAnchor(
					el,
					position.anchor,
					undefined,
					undefined,
					position.neighborhood,
				),
			);
	});
</script>

<main class="screen-nav-host">
	<div
		bind:this={container}
		class="h-full w-full overflow-y-auto overscroll-none"
		onscroll={() => {
			if (!container) return;
			const anchor = captureScrollAnchor(container);
			navigationMemory.setSurfaceAnchor(
				"settings",
				anchor,
				accountSession,
				captureScrollNeighborhood(container, anchor.itemKey),
			);
		}}
	>
		<div class="flex w-full p-4 pb-nav-clear">
			<div class="m-auto flex w-full max-w-120 flex-col gap-3 pb-16">
				<div class="overflow-hidden rounded-2xl border bg-card shadow-sm">
					<ProfileLink id={data.ourProfileId} grouped />
					<div class="mx-4 border-t" role="separator"></div>
					<ManageAlbumsLink />
				</div>
				<span class="h-1" role="separator"></span>
				<AccountSettingsLink />
				<AppSettingsLink />
				<DeveloperSettingsLink />
				<SignOutButton />
				<span role="separator"></span>
				<Socials />
				<span
					class="px-4 py-2 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground select-text"
				>
					{version}
				</span>
			</div>
		</div>
	</div>
</main>
