<script lang="ts">
	import { page } from "$app/state";
	import { ArrowLeftIcon } from "phosphor-svelte";

	import ProgressiveBlur from "$lib/components/shared/ProgressiveBlur.svelte";
	import { closeAppDetail } from "$lib/navigation/app-navigation";

	const base = "/(protected)/(navbar)/settings/(subpage)";
	const routes: Record<string, { title: string }> = {
		[`${base}/account`]: { title: "Account Settings" },
		[`${base}/account/privacy`]: {
			title: "Privacy",
		},
		[`${base}/account/email`]: {
			title: "Change Email",
		},
		[`${base}/account/password`]: {
			title: "Change Password",
		},
		[`${base}/account/blocked`]: {
			title: "Blocked Users",
		},
		[`${base}/account/hidden`]: {
			title: "Hidden Users",
		},
		[`${base}/account/delete`]: {
			title: "Delete Account",
		},
		[`${base}/app`]: { title: "App Settings" },
		[`${base}/developer`]: {
			title: "Developer Settings",
		},
		[`${base}/app/notifications`]: {
			title: "Notifications",
		},
		[`${base}/profile`]: { title: "Edit Profile" },
	};

	const current = $derived(
		(page.route.id && routes[page.route.id]) ?? {
			title: "",
		},
	);
</script>

<ProgressiveBlur
	direction="topToBottom"
	class="fixed top-0 left-0 z-20 h-[calc(4.75rem+var(--safe-area-top))] w-full shrink-0"
	bgClass="bg-linear-to-b from-background to-transparent"
	contentClass="flex items-center h-full pe-5.5 pt-(--safe-area-top)"
	tag="nav"
>
	<button
		type="button"
		onclick={() => void closeAppDetail(page.url.pathname, page.state)}
		class="flex h-full w-19 shrink-0 items-center justify-center"
		aria-label="Back"
	>
		<ArrowLeftIcon size={32} />
	</button>
	<span class="min-w-0 truncate">
		{current.title}
	</span>
</ProgressiveBlur>
