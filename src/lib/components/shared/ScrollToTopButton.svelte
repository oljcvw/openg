<script lang="ts">
	import CaretUpIcon from "phosphor-svelte/lib/CaretUpIcon";
<<<<<<< HEAD

=======
	import { prefersReducedMotion } from "svelte/motion";

	import { glideScrollTop } from "$lib/util/scroll";
>>>>>>> origin/forgejo-sync
	import { cn } from "$lib/util/utils";
	import ScrollJumpButton from "./ScrollJumpButton.svelte";

	let {
		container,
		class: className,
	}: {
		container: HTMLElement | null;
		class?: import("svelte/elements").ClassValue;
	} = $props();

	const TOP_SLOP_PX = 16;
<<<<<<< HEAD
	const GLIDE_TIMEOUT_MS = 1500;

	let atTop = $state(true);
	let gliding = false;
	let glideTimer: ReturnType<typeof setTimeout> | undefined;

	function releaseGlide() {
		gliding = false;
		clearTimeout(glideTimer);
=======
	const GLIDE_MS = 400;

	let atTop = $state(true);
	let cancelGlide: (() => void) | null = null;

	function releaseGlide() {
		cancelGlide?.();
		cancelGlide = null;
>>>>>>> origin/forgejo-sync
	}

	function settle() {
		releaseGlide();
		atTop = (container?.scrollTop ?? 0) <= TOP_SLOP_PX;
	}

	$effect(() => {
		const el = container;
		if (!el) return;

		const onScroll = () => {
<<<<<<< HEAD
			if (!gliding || el.scrollTop <= 1) settle();
=======
			if (cancelGlide === null) settle();
>>>>>>> origin/forgejo-sync
		};

		settle();
		el.addEventListener("scroll", onScroll, { passive: true });
<<<<<<< HEAD
		el.addEventListener("scrollend", settle, { passive: true });
=======
		el.addEventListener("scrollend", onScroll, { passive: true });
>>>>>>> origin/forgejo-sync
		el.addEventListener("wheel", releaseGlide, { passive: true });
		el.addEventListener("touchstart", releaseGlide, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
<<<<<<< HEAD
			el.removeEventListener("scrollend", settle);
=======
			el.removeEventListener("scrollend", onScroll);
>>>>>>> origin/forgejo-sync
			el.removeEventListener("wheel", releaseGlide);
			el.removeEventListener("touchstart", releaseGlide);
			releaseGlide();
		};
	});

	function scrollToTop() {
		const el = container;
		if (!el) return;
<<<<<<< HEAD
		atTop = true;
		gliding = true;
		clearTimeout(glideTimer);
		glideTimer = setTimeout(settle, GLIDE_TIMEOUT_MS);
		el.scrollTop = Math.min(el.scrollTop, el.clientHeight);
		el.scroll({ top: 0, behavior: "smooth" });
=======
		releaseGlide();
		atTop = true;
		if (prefersReducedMotion.current) {
			el.scrollTop = 0;
			return;
		}
		el.scrollTop = Math.min(el.scrollTop, el.clientHeight);
		cancelGlide = glideScrollTop({
			element: el,
			durationMs: GLIDE_MS,
			onLanded: settle,
		});
>>>>>>> origin/forgejo-sync
	}
</script>

{#if !atTop}
	<ScrollJumpButton
		label="Scroll to top"
		class={cn("absolute inset-x-0 z-10 mx-auto w-fit", className)}
		onclick={scrollToTop}
	>
		<CaretUpIcon />
	</ScrollJumpButton>
{/if}
