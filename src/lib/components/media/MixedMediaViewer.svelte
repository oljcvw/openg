<script lang="ts">
	import "photoswipe/style.css";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";

	type MixedMediaViewerItem = {
		id: string;
		kind: "image" | "video";
		url: string | null;
		unavailableLabel?: string;
	};

	let {
		items,
		startIndex,
		opener = null,
		onClose,
	}: {
		items: MixedMediaViewerItem[];
		startIndex: number;
		opener?: HTMLElement | null;
		onClose: () => void;
	} = $props();

	$effect(() => {
		if (items.length === 0) {
			onClose();
			return;
		}
		let lightbox: PhotoSwipeLightbox | undefined;
		let disposed = false;
		let closeNotified = false;
		const restoreFocus = () => queueMicrotask(() => opener?.focus());
		const notifyClosed = () => {
			if (closeNotified) return;
			closeNotified = true;
			restoreFocus();
			onClose();
		};
		const closeViewer = () => {
			lightbox?.pswp?.close();
			return false;
		};
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
					mainClass: "pswp--buttons-visible",
					loop: false,
				});
				lightbox.addFilter("numItems", () => items.length);
				lightbox.addFilter("itemData", (_, index) => {
					const item = items[index];
					return item.url
						? { src: item.url, width: 1, height: 1 }
						: {
								html: `<div class="og-shared-media-unavailable">${escapeHtml(item.unavailableLabel ?? "Media unavailable")}</div>`,
								width: 1,
								height: 1,
							};
				});
				lightbox.addFilter(
					"useContentPlaceholder",
					(usePlaceholder, content) =>
						items[content.index]?.kind === "video" ? false : usePlaceholder,
				);
				lightbox.on("contentLoad", (event) => {
					const item = items[event.content.index];
					if (!item?.url || item.kind !== "video") return;
					event.preventDefault();
					const wrapper = document.createElement("div");
					const video = document.createElement("video");
					video.src = item.url;
					video.controls = true;
					video.playsInline = true;
					video.className = "size-full object-contain";
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
				lightbox.on("beforeOpen", () => {
					backGestureEventHandlers.add(closeViewer);
					window.addEventListener("keydown", onKeydown, true);
				});
				lightbox.on("close", () => {
					backGestureEventHandlers.delete(closeViewer);
					window.removeEventListener("keydown", onKeydown, true);
					notifyClosed();
				});
				lightbox.on("destroy", () => {
					backGestureEventHandlers.delete(closeViewer);
					window.removeEventListener("keydown", onKeydown, true);
				});
				lightbox.init();
				lightbox.loadAndOpen(
					Math.max(0, Math.min(startIndex, items.length - 1)),
				);
			})
			.catch(() => notifyClosed());

		return () => {
			disposed = true;
			backGestureEventHandlers.delete(closeViewer);
			window.removeEventListener("keydown", onKeydown, true);
			lightbox?.destroy();
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
			return escaped[character];
		});
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
</style>
