<script lang="ts">
	import "photoswipe/style.css";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { runtimeOwnership } from "$lib/dev/runtime-ownership";
	import { backLayerManager } from "$lib/navigation/app-navigation";
	import type { ConversationMediaViewerItem } from "$lib/chat/conversation-media-viewer.svelte";

	let {
		items,
		startIndex,
		opener = null,
		preload = [1, 2],
		statusLabel = null,
		onItemActivate = null,
		onClose,
	}: {
		items: ConversationMediaViewerItem[];
		startIndex: number;
		opener?: HTMLElement | null;
		preload?: [number, number];
		statusLabel?: string | null;
		onItemActivate?:
			| ((item: ConversationMediaViewerItem, index: number) => void)
			| null;
		onClose: () => void;
	} = $props();

	$effect(() => {
		if (items.length === 0) {
			onClose();
			return;
		}
		let lightbox: PhotoSwipeLightbox | undefined;
		const releaseViewer = runtimeOwnership.acquire("media-viewer");
		let disposed = false;
		let closeNotified = false;
		let releaseBackLayer: (() => void) | null = null;
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
		const restoreFocus = () => queueMicrotask(() => opener?.focus());
		const notifyClosed = () => {
			if (closeNotified) return;
			closeNotified = true;
			restoreFocus();
			onClose();
		};
		const closeViewer = () => {
			lightbox?.pswp?.close();
			return "handled" as const;
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
					preload,
				});
				lightbox.addFilter("numItems", () => items.length);
				lightbox.addFilter("itemData", (_, index) => {
					const item = items[index];
					return item.url
						? {
								src: item.url,
								width: item.width ?? 1,
								height: item.height ?? 1,
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
						items[content.index]?.kind === "video" ? false : usePlaceholder,
				);
				lightbox.on("contentLoad", (event) => {
					const item = items[event.content.index];
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
				if (statusLabel !== null) {
					lightbox.on("uiRegister", () => {
						lightbox?.pswp?.ui?.registerElement({
							name: "shared-media-status",
							order: 8,
							isButton: false,
							appendTo: "wrapper",
							html: escapeHtml(statusLabel),
						});
					});
				}
				if (onItemActivate !== null) {
					const activateCurrent = () => {
						const index = lightbox?.pswp?.currIndex ?? 0;
						const item = items[index];
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
				lightbox.on("close", () => {
					disposeOwnedVideos();
					unregisterBackLayer();
					window.removeEventListener("keydown", onKeydown, true);
					notifyClosed();
				});
				lightbox.on("destroy", () => {
					disposeOwnedVideos();
					unregisterBackLayer();
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
			releaseViewer();
			disposeOwnedVideos();
			unregisterBackLayer();
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
