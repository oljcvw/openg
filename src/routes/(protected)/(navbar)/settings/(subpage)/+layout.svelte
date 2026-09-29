<script lang="ts">
<<<<<<< HEAD
	import { afterNavigate, beforeNavigate } from "$app/navigation";

	import SettingsNavBar from "../SettingsNavBar.svelte";
=======
	import SubpageScreen from "$lib/components/shared/SubpageScreen.svelte";

	const base = "/(protected)/(navbar)/settings/(subpage)";
	const routes = {
		[`${base}/account`]: { title: "Account Settings", back: "/settings" },
		[`${base}/account/privacy`]: {
			title: "Privacy",
			back: "/settings/account",
		},
		[`${base}/account/blocked`]: {
			title: "Blocked Users",
			back: "/settings/account",
		},
		[`${base}/account/hidden`]: {
			title: "Hidden Users",
			back: "/settings/account",
		},
		[`${base}/albums`]: {
			title: "My Albums",
			back: "/settings",
			wide: true,
		},
		[`${base}/albums/new`]: {
			title: "New Album",
			back: "/settings/albums",
		},
		[`${base}/albums/[albumId]`]: {
			title: "Edit Album",
			back: "/settings/albums",
		},
		[`${base}/app`]: { title: "App Settings", back: "/settings" },
		[`${base}/app/notifications`]: {
			title: "Notifications",
			back: "/settings/app",
		},
		[`${base}/app/credits`]: {
			title: "Credits & Licenses",
			back: "/settings/app",
		},
		[`${base}/profile`]: { title: "Edit Profile", back: "/settings" },
	};
>>>>>>> origin/forgejo-sync

	let { children }: import("./$types").LayoutProps = $props();

	let scroller: HTMLDivElement | null = $state(null);
	const offsets: Record<string, number> = {};

	beforeNavigate(({ from }) => {
		if (from && scroller) offsets[from.url.pathname] = scroller.scrollTop;
	});

	afterNavigate(({ from, to, type }) => {
		if (!scroller || !to || type === "enter") return;
		const saved = offsets[to.url.pathname];
		if (type === "popstate") {
			if (saved !== undefined) scroller.scrollTop = saved;
			return;
		}
		const up = from?.url.pathname.startsWith(`${to.url.pathname}/`);
		scroller.scrollTop = up ? (saved ?? 0) : 0;
	});
</script>

<<<<<<< HEAD
<SettingsNavBar />
<main class="screen-nav-host">
	<div
		bind:this={scroller}
		class="h-full w-full overflow-y-auto overscroll-none"
		data-slot="settings-scroller"
	>
		<div
			class="flex min-h-full w-full px-4 pt-header-clear-19 pb-nav-clear"
		>
			<div class="mx-auto flex w-full max-w-120 flex-col gap-3 pb-16">
				{@render children?.()}
			</div>
		</div>
	</div>
</main>
=======
<SubpageScreen {routes} parent="/settings">
	{@render children?.()}
</SubpageScreen>
>>>>>>> origin/forgejo-sync
