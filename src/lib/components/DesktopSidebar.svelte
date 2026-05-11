<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import {
		ChatCircleIcon,
		DotsNineIcon,
		DropIcon,
		FireIcon,
		UserIcon,
	} from "phosphor-svelte";
	import { getMyProfile } from "$lib/api/profile";

	let { ourProfileId }: { ourProfileId: number } = $props();

	const myProfilePhotos = $derived(
		getMyProfile().then((profile) => profile.medias),
	);
	const pathname = $derived(page.url.pathname);

	const shortcuts: Record<string, string> = {
		"1": "/",
		"2": "/right-now",
		"3": "/interest",
		"4": "/chat",
	};

	function isPath(expectedPathname: string) {
		return pathname === expectedPathname;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;

		const href = shortcuts[event.key];
		if (!href) return;

		event.preventDefault();
		goto(href);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<aside
	aria-label="Primary navigation"
	class="hidden md:flex h-dvh w-22 shrink-0 flex-col items-center gap-2 border-e border-border bg-background/95 px-2 py-4 select-none"
>
	<nav class="flex flex-col gap-2" aria-label="Primary navigation">
		<a href="/" class="desktop-nav-link" aria-current={isPath("/") ? "page" : undefined}>
			<DotsNineIcon weight="fill" />
			<span>Browse</span>
			<kbd>⌘1</kbd>
		</a>
		<a
			href="/right-now"
			class="desktop-nav-link"
			aria-current={isPath("/right-now") ? "page" : undefined}
		>
			<DropIcon weight="fill" />
			<span>Right Now</span>
			<kbd>⌘2</kbd>
		</a>
		<a
			href="/interest"
			class="desktop-nav-link"
			aria-current={isPath("/interest") ? "page" : undefined}
		>
			<FireIcon weight="fill" />
			<span>Interest</span>
			<kbd>⌘3</kbd>
		</a>
		<a
			href="/chat"
			class="desktop-nav-link"
			aria-current={isPath("/chat") ? "page" : undefined}
		>
			<ChatCircleIcon weight="fill" />
			<span>Inbox</span>
			<kbd>⌘4</kbd>
		</a>
	</nav>

	<a
		href="/profile/{ourProfileId}"
		class="mt-auto flex size-12 items-center justify-center rounded-full border border-border bg-neutral-800 p-1 focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50"
		aria-label="Open your profile"
	>
		{#await myProfilePhotos then photos}
			{@const mainPhoto = photos[0]}
			{#if mainPhoto}
				<img
					src="https://cdns.grindr.com/images/thumb/320x320/{mainPhoto.mediaHash}"
					alt=""
					width="48"
					height="48"
					loading="lazy"
					class="size-full rounded-full object-cover"
				/>
			{:else}
				<UserIcon weight="fill" class="size-6 text-muted-foreground" />
			{/if}
		{/await}
	</a>
</aside>

<style lang="postcss">
	@reference "../../layout.css";

	.desktop-nav-link {
		@apply flex w-16 flex-col items-center gap-1 rounded-2xl border border-transparent px-2 py-2 text-center text-[11px] leading-tight text-muted-foreground hover:bg-input/20 hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:border-input aria-[current=page]:text-accent;
	}

	.desktop-nav-link :global(svg) {
		@apply size-5;
	}

	.desktop-nav-link kbd {
		@apply text-[9px] text-muted-foreground/70;
	}
</style>
