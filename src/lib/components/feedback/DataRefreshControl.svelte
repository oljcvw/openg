<script lang="ts">
	import { tick } from "svelte";
	import { expoOut } from "svelte/easing";
	import { Tween } from "svelte/motion";
	import { fade, type TransitionConfig } from "svelte/transition";
	import type { ClassValue } from "svelte/elements";

	import { Button } from "$lib/components/ui/button";
	import { Skeleton } from "$lib/components/ui/skeleton";

	let {
		updating,
		position,
		container,
		windowScroll = false,
		offset = 0,
		mode = "button",
		updatingLabel = "Updating...",
		idleLabel = "Refresh",
		class: className,
		containerClass,
		onclick,
	}: {
		updating?: boolean;
		position: "top" | "bottom";
		container?: HTMLElement | null;
		windowScroll?: boolean;
		offset?: number;
		mode?: "button" | "pull";
		updatingLabel?: string;
		idleLabel?: string;
		class: ClassValue;
		containerClass?: ClassValue;
		onclick?: () => void;
	} = $props();

	const buttonHeight = 32; // px
	const concealSlack = 8; // px
	const stickyScrolledOffset = 16; // px
	const boundarySettleDelay = 50; // ms
	const idleDelay = 200; // ms
	const labelTransition: TransitionConfig = {
		duration: 200,
		easing: expoOut,
	};
	const revealTransition: TransitionConfig = {
		duration: 250,
		easing: expoOut,
	};

	let mounted = $state(false);
	let realHeight = $state(0);
	let gap = $state(0);
	let revealed = $state(false);
	let scrolling = $state(false);
	let scrolled = $state(false);
	let distance = $state(Infinity);
	let measuredOffset = $state(0);

	let suppressRevealUntilIdle = false;
	let previousUpdating = false;

	const progress = new Tween(0, revealTransition);

	const space = $derived(realHeight + gap);
	const distanceBeyondButton = $derived(distance - (revealed ? space : 0));

	const effectiveOffset = $derived(windowScroll ? measuredOffset + offset : 0);
	const verticalOffsetMax = $derived.by(() => {
		let value = realHeight;
		if (windowScroll) {
			value += effectiveOffset;
		} else if (container) {
			const paddingStyle =
				window.getComputedStyle(container)[
					position === "top" ? "paddingTop" : "paddingBottom"
				];
			value += parseInt(paddingStyle, 10);
		}
		return -value;
	});
	const stickyMargin = $derived(
		effectiveOffset + (scrolled ? stickyScrolledOffset : 0),
	);
	const verticalOffset = Tween.of(
		() => (updating ? stickyMargin : verticalOffsetMax),
		labelTransition,
	);

	const scrollEl = $derived.by(() => {
		if (!windowScroll) return container;
		if (typeof document === "undefined") return null;
		return document.scrollingElement ?? document.documentElement;
	});
	const scrollTop = () => scrollEl?.scrollTop ?? 0;
	const maxScrollY = () =>
		scrollEl ? scrollEl.scrollHeight - scrollEl.clientHeight : 0;
	const scrollToY = (top: number, behavior: ScrollBehavior) => {
		if (windowScroll) window.scroll({ top, behavior });
		else container?.scroll({ top, behavior });
	};
	const scrollByY = (delta: number) => {
		if (scrollEl) scrollEl.scrollTop += delta;
	};
	const occupiedAt = (p: number) =>
		Math.round(p * realHeight) + Math.round(-gap * (1 - p)) + gap;

	export function scrollToRest(behavior: ScrollBehavior = "instant") {
		if (!scrollEl) return;
		const rest = occupiedAt(progress.current);
		const top = position === "top" ? rest : maxScrollY() - rest;
		if (Math.abs(scrollTop() - top) >= 1) suppressRevealUntilIdle = true;
		scrollToY(top, behavior);
	}

	// Reveal while updating; conceal once idle and scrolled clear of the button.
	// Pull mode: force collapse when refresh finishes so grid returns flush to top.
	$effect(() => {
		const finishingUpdate = previousUpdating && !updating;
		previousUpdating = !!updating;

		if (updating && !revealed) {
			revealed = true;
			return;
		}

		if (finishingUpdate && revealed) {
			revealed = false;
			void tick().then(() => scrollToRest("smooth"));
			return;
		}

		if (
			!updating &&
			revealed &&
			!scrolling &&
			verticalOffset.current === verticalOffsetMax &&
			distanceBeyondButton > concealSlack
		) {
			revealed = false;
		}
	});

	$effect(() => {
		if (revealed) {
			void progress.set(1);
		} else if (progress.current > 0) {
			void progress.set(0, { duration: 0 });
		}
	});

	// Keep the top-anchored scroll position stable as the control grows/shrinks.
	let compensated = 0;
	$effect(() => {
		const occupied = occupiedAt(progress.current);
		const delta = occupied - compensated;
		compensated = occupied;
		if (delta === 0 || position !== "top") return;
		scrollByY(delta);
	});

	// Initialize measurements and resting position once the container exists.
	$effect(() => {
		if (!container) {
			mounted = false;
			return;
		}
		mounted = true;
		gap = parseInt(window.getComputedStyle(container).gap, 10) || 0;
		const anchorEl = windowScroll
			? scrollEl instanceof HTMLElement
				? scrollEl
				: null
			: container;
		const previousAnchor = anchorEl?.style.overflowAnchor ?? "";
		if (anchorEl) anchorEl.style.overflowAnchor = "none";
		if (!windowScroll) void tick().then(() => scrollToRest());
		return () => {
			if (anchorEl) anchorEl.style.overflowAnchor = previousAnchor;
		};
	});

	$effect(() => {
		if (!windowScroll || !container || position !== "top") return;
		const el = container;
		const measure = () => {
			const header = document.querySelector("[data-fixed-header]");
			measuredOffset = header
				? header.getBoundingClientRect().bottom
				: el.getBoundingClientRect().top + scrollTop();
		};
		void tick().then(measure);
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	});

	// Track scroll/wheel activity to reveal/conceal the control.
	$effect(() => {
		if (!container || !scrollEl) return;
		const target: EventTarget = windowScroll ? window : container;

		const updateDistance = () => {
			distance = position === "top" ? scrollTop() : maxScrollY() - scrollTop();
		};

		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const onIdle = () => {
			scrolling = false;
			suppressRevealUntilIdle = false;
		};
		const markActivity = () => {
			scrolling = true;
			clearTimeout(idleTimer);
			idleTimer = setTimeout(onIdle, idleDelay);
		};

		let boundaryRevealTimer: ReturnType<typeof setTimeout> | undefined;
		const cancelBoundaryReveal = () => {
			clearTimeout(boundaryRevealTimer);
			boundaryRevealTimer = undefined;
		};
		const armBoundaryReveal = () => {
			cancelBoundaryReveal();
			if (Math.abs(distance) >= 1 || revealed) return;
			boundaryRevealTimer = setTimeout(() => {
				boundaryRevealTimer = undefined;
				if (Math.abs(distance) < 1 && !revealed) revealed = true;
			}, boundarySettleDelay);
		};

		let wasScrolled = false;
		let pullGesture = false;
		let touchStartY = 0;

		const tryAutoRefresh = () => {
			if (mode !== "pull" || !onclick || updating || !revealed) return;
			if (Math.abs(distance) >= 1) return;
			if (!wasScrolled && !pullGesture) return;
			onclick();
			wasScrolled = false;
			pullGesture = false;
		};

		const onScroll = () => {
			scrolled =
				position === "top" ? scrollTop() > 0 : scrollTop() < maxScrollY() - 1;
			if (position === "top" && scrollTop() > 0) wasScrolled = true;
			markActivity();
			updateDistance();
			if (revealed || suppressRevealUntilIdle) {
				cancelBoundaryReveal();
				return;
			}
			if (Math.abs(distance) < 1) {
				armBoundaryReveal();
			} else {
				cancelBoundaryReveal();
			}
		};
		const onScrollEnd = () => {
			clearTimeout(idleTimer);
			onIdle();
			updateDistance();
			tryAutoRefresh();
		};
		const onWheel = (e: WheelEvent) => {
			markActivity();
			const towardBoundary = position === "top" ? e.deltaY < 0 : e.deltaY > 0;
			if (towardBoundary) {
				if (mode === "pull" && Math.abs(distance) < 1) pullGesture = true;
				armBoundaryReveal();
			} else {
				cancelBoundaryReveal();
			}
		};
		const onTouchStart = (e: TouchEvent) => {
			touchStartY = e.touches[0]?.clientY ?? 0;
		};
		const onTouchMove = (e: TouchEvent) => {
			if (mode !== "pull") return;
			const y = e.touches[0]?.clientY ?? 0;
			if (Math.abs(distance) < 1 && y - touchStartY > 10) {
				pullGesture = true;
				markActivity();
				armBoundaryReveal();
			}
		};

		const resizeObserver = new ResizeObserver(updateDistance);
		const observe = () => {
			resizeObserver.disconnect();
			resizeObserver.observe(container);
			for (const child of container.children) {
				resizeObserver.observe(child);
			}
		};
		observe();

		const mutationObserver = new MutationObserver(() => {
			observe();
			updateDistance();
		});
		mutationObserver.observe(container, { childList: true });

		target.addEventListener("scroll", onScroll);
		target.addEventListener("scrollend", onScrollEnd);
		target.addEventListener("wheel", onWheel as EventListener, {
			passive: true,
		});
		target.addEventListener("touchstart", onTouchStart as EventListener, {
			passive: true,
		});
		target.addEventListener("touchmove", onTouchMove as EventListener, {
			passive: true,
		});
		return () => {
			target.removeEventListener("scroll", onScroll);
			target.removeEventListener("scrollend", onScrollEnd);
			target.removeEventListener("wheel", onWheel as EventListener);
			target.removeEventListener("touchstart", onTouchStart as EventListener);
			target.removeEventListener("touchmove", onTouchMove as EventListener);
			clearTimeout(idleTimer);
			clearTimeout(boundaryRevealTimer);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	});
</script>

{#if mounted}
	<div
		class={[
			"flex flex-col overflow-clip shrink-0 h-(--drc-height) opacity-(--drc-opacity) sticky",
			{ "justify-end": position === "top" },
			{
				"mt-(--drc-margin)": position === "bottom",
				"mb-(--drc-margin)": position === "top",

				"top-(--drc-offset)": position === "top",
				"bottom-(--drc-offset)": position === "bottom",
			},
			containerClass,
		]}
		style="
			--drc-progress: {progress.current};
			--drc-height: round(calc(var(--drc-progress) * {realHeight}px), 1px);
			--drc-margin: round(calc({-gap}px * (1 - var(--drc-progress))), 1px);
			--drc-opacity: max(0, calc(var(--drc-progress) * 3 - 2));

			--drc-offset: {verticalOffset.current}px;
		"
	>
		{@render control()}
	</div>
{:else}
	<div
		class={["absolute flex invisible", containerClass]}
		bind:offsetHeight={realHeight}
	>
		{@render control()}
	</div>
{/if}

{#snippet control()}
	{#if mode === "pull"}
		<div
			class={[
				"relative self-center transition-colors duration-(--duration) w-25 h-(--height) backdrop-blur-2xl rounded-md",
				{ "bg-muted/50": updating },
				className,
			]}
			style="
				--duration: {labelTransition.duration}ms;
				--height: {buttonHeight}px;
			"
		>
			{#if updating}
				<Skeleton class="size-full absolute bg-input" />
				<span class="label" transition:fade={labelTransition}>{updatingLabel}</span>
			{/if}
		</div>
	{:else}
		<Button
			size="sm"
			variant={updating ? "ghost" : "default"}
			disabled={updating}
			class={[
				"relative self-center transition-colors duration-(--duration) w-25 h-(--height) backdrop-blur-2xl",
				{ "disabled:opacity-100 bg-muted/50": updating },
				className,
			]}
			style="
				--duration: {labelTransition.duration}ms;
				--height: {buttonHeight}px;
			"
			{onclick}
		>
			{#if updating}
				<Skeleton class="size-full absolute bg-input" />
				<span class="label" transition:fade={labelTransition}>{updatingLabel}</span>
			{:else}
				<span class="label" transition:fade={labelTransition}>{idleLabel}</span>
			{/if}
		</Button>
	{/if}
{/snippet}

<style lang="postcss">
	@reference "$layout";

	.label {
		@apply absolute z-10 top-1/2 left-1/2 -translate-1/2;
	}
</style>
