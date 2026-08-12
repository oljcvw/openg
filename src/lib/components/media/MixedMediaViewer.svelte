<script lang="ts">
	import "photoswipe/style.css";
	import { tick, untrack } from "svelte";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import {
		type ConversationMediaViewerItem,
		type ViewerDiagnosticContext,
	} from "$lib/chat/conversation-media-viewer.svelte";
	import { runtimeOwnership } from "$lib/dev/runtime-ownership";
	import { backLayerManager } from "$lib/navigation/app-navigation";
	import {
		reportViewerDiagnostic,
		type ViewerDiagnostic,
	} from "$lib/platform/client-diagnostics";

	let {
		items,
		startIndex,
		opener = null,
		preload = [1, 2],
		statusLabel = null,
		diagnostics = {
			surface: "chat",
			cacheSource: "none",
			access: "persistent",
		},
		onItemActivate = null,
		onOpening = () => {},
		onOpened = () => {},
		onClose,
	}: {
		items: ConversationMediaViewerItem[];
		startIndex: number;
		opener?: HTMLElement | null;
		preload?: [number, number];
		statusLabel?: string | null;
		diagnostics?: ViewerDiagnosticContext;
		onItemActivate?:
			((item: ConversationMediaViewerItem, index: number) => void) | null;
		onOpening?: () => void;
		onOpened?: () => void;
		onClose: () => void;
	} = $props();
	let mutableItems: ConversationMediaViewerItem[] = [];
	let activeLightbox: PhotoSwipeLightbox | undefined;

	$effect(() => {
		const next = items;
		const pswp = activeLightbox?.pswp;
		const currentIndex = pswp?.currIndex ?? startIndex;
		const activeId = mutableItems[currentIndex]?.id;
		mutableItems.splice(0, mutableItems.length, ...next);
		if (!pswp) return;
		const preservedIndex = activeId
			? mutableItems.findIndex((item) => item.id === activeId)
			: -1;
		const nextIndex =
			preservedIndex >= 0
				? preservedIndex
				: Math.max(0, Math.min(startIndex, mutableItems.length - 1));
		pswp.updateSize();
		if (nextIndex !== pswp.currIndex) pswp.goTo(nextIndex);
		pswp.refreshSlideContent(nextIndex);
	});

	$effect(() => {
		const initialItems = untrack(() => items);
		const initialStartIndex = untrack(() => startIndex);
		const initialOpener = untrack(() => opener);
		const initialPreload = untrack(() => preload);
		const initialStatusLabel = untrack(() => statusLabel);
		const diagnosticContext = untrack(() => diagnostics);
		mutableItems.splice(0, mutableItems.length, ...initialItems);
		if (mutableItems.length === 0) {
			onClose();
			return;
		}
		let lightbox: PhotoSwipeLightbox | undefined;
		const requestedAt = performance.now();
		const report = (
			event: ViewerDiagnostic["event"],
			index = initialStartIndex,
			failure: ViewerDiagnostic["failure"] = "none",
		) => {
			const item = mutableItems[index];
			reportViewerDiagnostic({
				event,
				...diagnosticContext,
				mediaKind: item?.kind ?? mediaKind(mutableItems),
				cacheSource:
					diagnosticContext.cacheSource === "none"
						? cacheSource(mutableItems)
						: diagnosticContext.cacheSource,
				countBucket: countBucket(mutableItems.length),
				positionBucket: positionBucket(index, mutableItems.length),
				latencyBucket: latencyBucket(performance.now() - requestedAt),
				failure,
			});
		};
		report("open_requested");
		const releaseViewer = runtimeOwnership.acquire("media-viewer");
		let disposed = false;
		let closeNotified = false;
		let closeRequested = false;
		let releaseBackLayer: (() => void) | null = null;
		let closeButton: HTMLButtonElement | null = null;
		const ownedVideos = new Set<HTMLVideoElement>();
		const videoLeases = new Map<HTMLVideoElement, () => void>();
		const contentVideos = new WeakMap<object, HTMLVideoElement>();
		const disposeVideo = (content: object) => {
			const video = contentVideos.get(content);
			if (!video || !ownedVideos.delete(video)) return;
			contentVideos.delete(content);
			video.pause();
			video.removeAttribute("src");
			video.load();
			videoLeases.get(video)?.();
			videoLeases.delete(video);
		};
		const disposeOwnedVideos = () => {
			for (const video of ownedVideos) {
				video.pause();
				video.removeAttribute("src");
				video.load();
				videoLeases.get(video)?.();
			}
			ownedVideos.clear();
			videoLeases.clear();
		};
		const unregisterBackLayer = () => {
			releaseBackLayer?.();
			releaseBackLayer = null;
		};
		const notifyClosed = () => {
			if (closeNotified) return;
			closeNotified = true;
			onClose();
			void tick().then(() => {
				if (initialOpener?.isConnected)
					initialOpener.focus({ preventScroll: true });
			});
		};
		const closeViewer = () => {
			const pswp = lightbox?.pswp;
			if (!pswp || pswp.opener.isOpening) {
				closeRequested = true;
				return "handled" as const;
			}
			closeRequested = false;
			pswp.close();
			return "handled" as const;
		};
		const onCloseButtonClick = () => closeViewer();
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			closeViewer();
		};

		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				if (disposed) return;
				lightbox = new PhotoSwipeLightbox({
					pswpModule: () => import("photoswipe"),
					mainClass: "pswp--og-media-viewer pswp--buttons-visible",
					loop: false,
					preload: initialPreload,
					counter: false,
					close: true,
					closeTitle: "Close media viewer",
					trapFocus: true,
					returnFocus: false,
					errorMsg: "Media could not be loaded. Close and try again.",
				});
				activeLightbox = lightbox;
				lightbox.addFilter("numItems", () => mutableItems.length);
				lightbox.addFilter("itemData", (_, index) => {
					const item = mutableItems[index];
					if (!item) return { html: "", width: 1, height: 1 };
					const fallbackWidth = Math.max(2, window.innerWidth || 1200);
					const fallbackHeight = Math.max(2, window.innerHeight || 1200);
					const hasDimensions =
						item.width !== undefined &&
						item.height !== undefined &&
						item.width > 1 &&
						item.height > 1;
					return item.url
						? {
								src: item.url,
								width: hasDimensions ? item.width : fallbackWidth,
								height: hasDimensions ? item.height : fallbackHeight,
							}
						: {
								html: `<div class="og-shared-media-unavailable">${escapeHtml(item.unavailableLabel ?? "Media unavailable")}</div>`,
								width: 1,
								height: 1,
							};
				});
				lightbox.addFilter(
					"useContentPlaceholder",
					(usePlaceholder, content) =>
						mutableItems[content.index]?.kind === "video"
							? false
							: usePlaceholder,
				);
				lightbox.addFilter("contentErrorElement", (_element, content) => {
					const wrapper = document.createElement("div");
					wrapper.className = "og-media-viewer-error";
					wrapper.setAttribute("role", "alert");
					const message = document.createElement("p");
					message.textContent = "Media could not be loaded.";
					const retry = document.createElement("button");
					retry.type = "button";
					retry.textContent = "Try again";
					retry.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						lightbox?.pswp?.refreshSlideContent(content.index);
					});
					wrapper.append(message, retry);
					return wrapper;
				});
				lightbox.on("contentLoad", (event) => {
					const item = mutableItems[event.content.index];
					if (!item?.url || item.kind !== "video") return;
					event.preventDefault();
					const wrapper = document.createElement("div");
					const video = document.createElement("video");
					video.src = item.url;
					if (item.poster) video.poster = item.poster;
					video.controls = true;
					video.playsInline = true;
					video.className = "size-full object-contain";
					ownedVideos.add(video);
					contentVideos.set(event.content, video);
					videoLeases.set(video, runtimeOwnership.acquire("media-element"));
					wrapper.appendChild(video);
					event.content.element = wrapper;
					event.content.state = "loading";
					if (video.readyState >= 3) event.content.onLoaded();
					else {
						video.addEventListener(
							"loadeddata",
							() => event.content.onLoaded(),
							{
								once: true,
							},
						);
						video.addEventListener("error", () => event.content.onError(), {
							once: true,
						});
					}
				});
				lightbox.on("contentRemove", (event) => disposeVideo(event.content));
				lightbox.on("contentDestroy", (event) => disposeVideo(event.content));
				lightbox.on("loadComplete", (event) => {
					if (!event.isError) report("item_loaded", event.content.index);
				});
				lightbox.on("loadError", (event) => {
					report("item_failed", event.content.index, "unknown");
				});
				lightbox.on("uiRegister", () => {
					lightbox?.pswp?.ui?.registerElement({
						name: "shared-media-position",
						order: 7,
						isButton: false,
						appendTo: "wrapper",
						onInit: (element, pswp) => {
							element.setAttribute("role", "status");
							element.setAttribute("aria-live", "polite");
							element.setAttribute("aria-atomic", "true");
							const update = () => {
								element.textContent = `${pswp.currIndex + 1} / ${pswp.getNumItems()}`;
							};
							update();
							pswp.on("change", update);
						},
					});
				});
				if (initialStatusLabel !== null) {
					lightbox.on("uiRegister", () => {
						lightbox?.pswp?.ui?.registerElement({
							name: "shared-media-status",
							order: 8,
							isButton: false,
							appendTo: "wrapper",
							html: escapeHtml(initialStatusLabel),
						});
					});
				}
				if (onItemActivate !== null) {
					const activateCurrent = () => {
						const index = lightbox?.pswp?.currIndex ?? 0;
						const item = mutableItems[index];
						if (item) onItemActivate(item, index);
					};
					lightbox.on("afterInit", activateCurrent);
					lightbox.on("change", activateCurrent);
				}
				lightbox.on("beforeOpen", () => {
					unregisterBackLayer();
					releaseBackLayer = backLayerManager.register({
						priority: "viewer",
						handler: closeViewer,
					});
					window.addEventListener("keydown", onKeydown, true);
				});
				lightbox.on("afterInit", () => {
					const viewerElement = lightbox?.pswp?.element;
					viewerElement?.setAttribute("role", "dialog");
					viewerElement?.setAttribute("aria-modal", "true");
					viewerElement?.setAttribute("aria-label", "Media viewer");
					closeButton =
						viewerElement?.querySelector<HTMLButtonElement>(
							".pswp__button--close",
						) ?? null;
					closeButton?.addEventListener("click", onCloseButtonClick);
					report("opened");
					onOpened();
				});
				lightbox.on("openingAnimationEnd", () => {
					if (closeRequested) closeViewer();
				});
				lightbox.on("close", () => {
					closeRequested = false;
					report("closed", lightbox?.pswp?.currIndex ?? initialStartIndex);
					disposeOwnedVideos();
					unregisterBackLayer();
					window.removeEventListener("keydown", onKeydown, true);
					notifyClosed();
				});
				lightbox.on("destroy", () => {
					closeButton?.removeEventListener("click", onCloseButtonClick);
					closeButton = null;
					report("destroyed", lightbox?.pswp?.currIndex ?? initialStartIndex);
					disposeOwnedVideos();
					unregisterBackLayer();
					window.removeEventListener("keydown", onKeydown, true);
				});
				lightbox.init();
				onOpening();
				lightbox.loadAndOpen(
					Math.max(0, Math.min(initialStartIndex, mutableItems.length - 1)),
				);
			})
			.catch(() => {
				report("item_failed", initialStartIndex, "unknown");
				notifyClosed();
			});

		return () => {
			disposed = true;
			closeButton?.removeEventListener("click", onCloseButtonClick);
			closeButton = null;
			releaseViewer();
			disposeOwnedVideos();
			unregisterBackLayer();
			window.removeEventListener("keydown", onKeydown, true);
			lightbox?.destroy();
			activeLightbox = undefined;
			lightbox = undefined;
		};
	});

	function escapeHtml(value: string): string {
		return value.replace(/[&<>"']/g, (character) => {
			const escaped: Record<string, string> = {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			};
			return escaped[character] ?? character;
		});
	}

	function mediaKind(
		values: ConversationMediaViewerItem[],
	): ViewerDiagnostic["mediaKind"] {
		if (values.length === 0) return "none";
		return values.every((item) => item.kind === values[0]?.kind)
			? (values[0]?.kind ?? "none")
			: "mixed";
	}

	function cacheSource(
		values: ConversationMediaViewerItem[],
	): ViewerDiagnostic["cacheSource"] {
		const urls = values.flatMap((item) => (item.url ? [item.url] : []));
		if (urls.length === 0) return "none";
		return urls.some((url) => /^https?:/i.test(url)) ? "network" : "local";
	}

	function countBucket(count: number): ViewerDiagnostic["countBucket"] {
		if (count === 0) return "none";
		if (count === 1) return "one";
		if (count <= 5) return "few";
		return "many";
	}

	function positionBucket(
		index: number,
		count: number,
	): ViewerDiagnostic["positionBucket"] {
		if (count === 0) return "none";
		if (index <= 0) return "first";
		if (index >= count - 1) return "last";
		return "middle";
	}

	function latencyBucket(
		milliseconds: number,
	): ViewerDiagnostic["latencyBucket"] {
		if (milliseconds < 100) return "instant";
		if (milliseconds < 1_000) return "fast";
		if (milliseconds < 5_000) return "slow";
		return "very_slow";
	}
</script>

<style>
	:global(.pswp__shared-media-position) {
		position: absolute;
		top: calc(var(--safe-area-top) + 0.75rem);
		left: 50%;
		z-index: 20;
		transform: translateX(-50%);
		border-radius: 9999px;
		background: rgb(0 0 0 / 75%);
		padding: 0.25rem 0.75rem;
		color: white;
		font-size: 0.75rem;
	}
	:global(.og-shared-media-unavailable) {
		display: grid;
		width: 100%;
		height: 100%;
		place-items: center;
		padding: 2rem;
		color: white;
		text-align: center;
	}
	:global(.og-media-viewer-error) {
		display: grid;
		min-width: min(22rem, calc(100vw - 2rem));
		place-items: center;
		gap: 0.75rem;
		padding: 1.5rem;
		border-radius: 1rem;
		background: rgb(0 0 0 / 75%);
		color: white;
		text-align: center;
	}
	:global(.og-media-viewer-error button) {
		min-width: 3rem;
		min-height: 3rem;
		padding: 0.5rem 1rem;
		border: 1px solid rgb(255 255 255 / 65%);
		border-radius: 9999px;
		font-weight: 600;
	}
	:global(.pswp--og-media-viewer .pswp__top-bar) {
		padding-top: var(--safe-area-top);
	}
	:global(.pswp--og-media-viewer .pswp__button--close) {
		min-width: 3rem;
		min-height: 3rem;
		margin-right: max(0.25rem, var(--safe-area-right));
		border-radius: 9999px;
		background: rgb(0 0 0 / 55%);
	}
	:global(.pswp--og-media-viewer .pswp__button--close:focus-visible) {
		outline: 2px solid white;
		outline-offset: 2px;
	}
</style>
