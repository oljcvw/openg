<script lang="ts">
	import "photoswipe/style.css";
	import { ImageBrokenIcon, ImagesIcon, VideoIcon } from "phosphor-svelte";
	import { mount, unmount } from "svelte";
	import { toast } from "svelte-sonner";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { showErrorToast } from "$lib/api/error";
	import { type AlbumContentResponse, getAlbumContent } from "$lib/api/messaging/albums";
	import { getProfile } from "$lib/api/users/profiles";
	import { getUnitsSnapshot } from "$lib/app-data/preferences.svelte";
	import ToastUnimplemented from "$lib/components/feedback/ToastUnimplemented.svelte";
	import type { AlbumMessage, Message } from "$lib/model/messaging/messages";
	import type { ConversationState } from "../conversation-state.svelte";
	import LockedMedia from "../LockedMedia.svelte";
	import MessageComposer from "../MessageComposer.svelte";
	import { createAlbumActionWheel } from "./album-action-wheel";
	import {
		buildAlbumFooter,
		type OwnerProfile,
	} from "./album-viewer-footer";
	import { MessageMediaState } from "./message-media.svelte";

	type ConversationProfile = {
		mediaHash: string | null;
		onlineUntil: number | null;
		name: string | null;
		profileId: number;
		distance: number | null;
	};

	/** Resolve the album owner's profile, reusing the conversation profile when possible. */
	async function resolveOwnerProfile(
		ownerId: number | null,
		conversationProfile: ConversationProfile | null,
	): Promise<OwnerProfile | null> {
		if (ownerId == null) return null;
		if (conversationProfile?.profileId === ownerId) {
			return {
				profileId: conversationProfile.profileId,
				mediaHash: conversationProfile.mediaHash,
				name: conversationProfile.name,
				distance: conversationProfile.distance ?? null,
			};
		}
		const fetched = await getProfile(ownerId);
		return {
			profileId: fetched.profileId,
			mediaHash:
				fetched.profileImageMediaHash ?? fetched.medias[0]?.mediaHash ?? null,
			name: fetched.displayName ?? null,
			distance: fetched.distance ?? null,
		};
	}

	/** Default fallback dimensions when probing fails. */
	const FALLBACK_DIMS = { width: 800, height: 1200 };

	/** Load intrinsic dimensions for an album slide by probing the media element. */
	async function loadMediaDimensions(
		slide: AlbumContentResponse["content"][number],
	): Promise<{ width: number; height: number }> {
		const url = slide.url;
		if (!url) return FALLBACK_DIMS;

		if (slide.contentType.startsWith("video/")) {
			const video = document.createElement("video");
			video.src = url;
			video.load();
			try {
				await waitForMediaEvent(video, "loadedmetadata", 1);
				return { width: video.videoWidth, height: video.videoHeight };
			} catch {
				console.warn(`Failed to probe video dimensions for ${url}`);
				return FALLBACK_DIMS;
			} finally {
				video.remove();
			}
		}
		const img = document.createElement("img");
		img.src = url;
		try {
			await waitForMediaEvent(img, "load");
			return { width: img.naturalWidth, height: img.naturalHeight };
		} catch {
			console.warn(`Failed to probe image dimensions for ${url}`);
			return FALLBACK_DIMS;
		} finally {
			img.remove();
		}
	}

	/** Resolve once a media element reaches the given readyState or errors out. */
	function waitForMediaEvent(
		el: HTMLMediaElement | HTMLImageElement,
		successEvent: string,
		readyState?: number,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (
				readyState !== undefined &&
				el instanceof HTMLMediaElement &&
				el.readyState >= readyState
			) {
				resolve();
				return;
			}
			el.addEventListener(successEvent, () => resolve(), { once: true });
			el.addEventListener("error", () => reject(new Error("Media load failed")), {
				once: true,
			});
		});
	}

	let {
		message,
		profile,
		conversationState,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		conversationId,
	}: {
		message: AlbumMessage["body"];
		profile: ConversationProfile | null;
		conversationState: ConversationState;
		conversationId?: string;
	} = $props();

	let ownerProfile: OwnerProfile | null = $state(null);

	const units = $derived(getUnitsSnapshot());
	const media = new MessageMediaState();

	const className: import("svelte/elements").ClassValue = $derived([
		"aspect-3/4 h-auto relative",
		{
			"ring ring-accent": message.hasUnseenContent,
			"w-2/5 min-w-35 max-w-60 ms-3": !media.clone,
			"size-full": media.clone,
		},
	]);

	const contentClass: import("svelte/elements").ClassValue = $derived([
		"rounded-xl",
		media.cornerClass,
	]);

	type LoadedAlbum = AlbumContentResponse & {
		content: (AlbumContentResponse["content"][number] & {
			width: number;
			height: number;
		})[];
	};

	type AlbumState =
		| { status: "idle" }
		| { status: "loading" }
		| { status: "error"; error: unknown }
		| { status: "open"; album: LoadedAlbum };

	let albumState = $state<AlbumState>({ status: "idle" });
	let cachedAlbum: LoadedAlbum | null = null;
	let cachedAlbumId: number | null = null;

	function openAlbum() {
		// Invalidate cache if the album changed.
		if (cachedAlbumId !== message.albumId) {
			cachedAlbum = null;
			cachedAlbumId = message.albumId;
		}
		if (cachedAlbum) {
			albumState = { status: "open", album: cachedAlbum };
		} else {
			albumState = { status: "loading" };
		}
	}

	function retryLoad() {
		albumState = { status: "loading" };
	}

	$effect(() => {
		if (albumState.status !== "loading") return;
		void (async () => {
			// Kick off the owner profile fetch in parallel
			const ownerPromise = resolveOwnerProfile(
				message.ownerProfileId,
				profile,
			);
			try {
				ownerProfile = await ownerPromise;
			} catch (error) {
				console.warn("Failed to resolve album owner profile", error);
				ownerProfile = null;
			}

			try {
				const res = await getAlbumContent(message.albumId);
				const loaded: LoadedAlbum = {
					...res,
					content: await Promise.all(
						res.content.map(async (slide) => {
							const dims = await loadMediaDimensions(slide);
							return { ...slide, ...dims };
						}),
					),
				};
				cachedAlbum = loaded;
				cachedAlbumId = message.albumId;
				albumState = { status: "open", album: loaded };
			} catch (error) {
				console.error("Failed to load album content", error);
				albumState = { status: "error", error };
			}
		})();
	});

	$effect(() => {
		if (albumState.status !== "open") return;
		const { album } = albumState;
		let lightbox: PhotoSwipeLightbox | undefined;
		let cancelled = false;
		const cleanups: (() => void)[] = [];

		void import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				if (cancelled) return;
				const lb = new PhotoSwipeLightbox({
					showHideAnimationType: "fade",
					pswpModule: () => import("photoswipe"),
					mainClass: "pswp--buttons-visible",
				});
				lightbox = lb;

				lb.addFilter("numItems", () => album.content.length);

				lb.addFilter("itemData", (_, index) => {
					const { url, width, height } = album.content[index];
					return { src: url, width, height };
				});

				lb.on("contentLoad", (event) => {
					const { content } = event;
					const slide = album.content[content.index];
					if (!slide?.contentType.startsWith("video/")) return;
					event.preventDefault();
					content.element = document.createElement("div");
					const video = document.createElement("video");
					video.src = slide.url;
					video.controls = true;
					video.playsInline = true;
					video.className = "max-w-full max-h-full m-auto";
					// Poster frame from thumbUrl
					if (slide.thumbUrl) {
						video.poster = slide.thumbUrl;
					}
					content.element.appendChild(video);
					content.state = "loading";
					if (video.readyState >= 3) {
						content.onLoaded();
					} else {
						video.addEventListener("loadeddata", () => content.onLoaded());
						video.addEventListener("error", () => {
							// Graceful: show the poster as a static image if video fails
							content.onError();
						});
					}
				});

				/** Lock the lightbox so the user can't switch slides while replying. */
				const lockLightbox = (pswp: import("photoswipe").default) => {
					pswp.options.allowPanToNext = false;
					pswp.options.arrowKeys = false;
					pswp.options.escKey = false;
				};

				/** Restore lightbox navigation after the reply composer closes. */
				const unlockLightbox = (pswp: import("photoswipe").default) => {
					pswp.options.allowPanToNext = true;
					pswp.options.arrowKeys = true;
					pswp.options.escKey = true;
				};

				let replyComposerEl: HTMLElement | null = null;
				let replyComposerInstance: ReturnType<typeof mount> | null = null;

				lb.on("uiRegister", () => {
					lb.pswp?.ui?.registerElement({
						name: "album-reply-composer",
						appendTo: "root",
						onInit(el) {
							const container = document.createElement("div");
							container.className = "pswp__album-reply-composer";
							container.style.display = "none";

							el.appendChild(container);
							replyComposerEl = container;
						},
					});
				});

				/** Close the in-lightbox reply composer and unlock navigation. */
				const closeReplyComposer = (pswp: import("photoswipe").default) => {
					if (replyComposerInstance) {
						unmount(replyComposerInstance);
						replyComposerInstance = null;
					}
					if (replyComposerEl) {
						replyComposerEl.style.display = "none";
						replyComposerEl.innerHTML = "";
					}
					// Show footer again
					const footerEl = document.getElementById("chat-album-footer");
					if (footerEl) {
						footerEl.style.display = "";
					}
					unlockLightbox(pswp);
				};

				/** Open the in-lightbox reply composer for the current slide. */
				const openReplyComposer = (
					pswp: import("photoswipe").default,
				) => {
					if (replyComposerInstance || !replyComposerEl) return;
					lockLightbox(pswp);

					// Hide footer so composer sits at the very bottom
					const footerEl = document.getElementById("chat-album-footer");
					if (footerEl) {
						footerEl.style.display = "none";
					}

					replyComposerEl.style.display = "flex";
					replyComposerEl.innerHTML = "";

					const closeBtn = document.createElement("button");
					closeBtn.type = "button";
					closeBtn.className = "pswp__album-reply-composer-close";
					closeBtn.setAttribute("aria-label", "Close reply");
					closeBtn.textContent = "✕";
					closeBtn.addEventListener("click", () => {
						if (lb.pswp) closeReplyComposer(lb.pswp);
					});

					try {
						replyComposerInstance = mount(MessageComposer, {
							target: replyComposerEl,
							props: {
								disabled: false,
								value: "",
								ref: null,
								onSend: (msg: Message) => {
									if (msg.type !== "Text") return;
									const text = msg.body.text.trim();
									if (text === "") return;
									const slide = album.content[pswp.currSlide?.index ?? 0];
									try {
										sendAlbumContentReply({
											conversationState,
											albumMessageBody: message,
											slide,
											text,
										});
									} catch (error) {
										console.error(error);
										showErrorToast({
											label: "Failed to send album reply",
											error,
										});
									}
									closeReplyComposer(pswp);
								},
							},
						});

						replyComposerEl.appendChild(closeBtn);

						// Auto-focus the textarea after mount
						setTimeout(() => {
							const textarea = replyComposerEl?.querySelector(
								"textarea",
							) as HTMLTextAreaElement | null;
							textarea?.focus();
						}, 50);
					} catch (error) {
						console.error("Failed to mount reply composer", error);
						showErrorToast({
							label: "Failed to open reply composer",
							error,
						});
						closeReplyComposer(pswp);
					}
				};

				lb.on("uiRegister", () => {
					lb.pswp?.ui?.registerElement({
						name: "chat-album-footer",
						order: 9,
						appendTo: "root",
						onInit(element, pswp) {
							element.className = "pswp__chat-album-footer";
							element.id = "chat-album-footer";

							// Determine expiry/view info from the album message body
							const expirationType = message.expirationType;
							// AlbumExpiration.ONCE = "1"
							const isOnceView = expirationType === "1";
							const isTimed =
								expirationType === "2" || // TEN_MINUTES
								expirationType === "3" || // ONE_HOUR
								expirationType === "4"; // ONE_DAY

							buildAlbumFooter(
								element,
								pswp,
								{
									owner: ownerProfile,
									albumName: album.albumName,
									contentLength: album.content.length,
									units,
									expiresAt: isTimed ? (message.expiresAt ?? null) : null,
									onceView: isOnceView,
								},
								cleanups,
							);

							const destroyWheel = createAlbumActionWheel(element, [
								{
									id: "reply",
									label: "Reply",
									icon: "💬",
									enabled: true,
									action: () => {
										openReplyComposer(pswp);
									},
								},
								{
									id: "tap",
									label: "Tap",
									icon: "🔥",
									enabled: !!ownerProfile?.profileId,
									action: () => {
										const slide =
											album.content[pswp.currSlide?.index ?? 0];
										try {
											sendAlbumContentReaction({
												conversationState,
												albumMessageBody: message,
												slide,
											});
										} catch (error) {
											console.error(error);
											showErrorToast({
												label: "Failed to send album tap",
												error,
											});
										}
									},
								},
								{
									id: "report",
									label: "Report",
									icon: "⚠️",
									enabled: true,
									action: () => {
										toast(ToastUnimplemented, {
											componentProps: {
												feature: "Report album content",
												issue: 215,
											},
										});
									},
								},
							]);
							cleanups.push(() => destroyWheel());
						},
					});
				});

				// Keyboard shortcut: number keys 1-9 jump to slide
				lb.on("uiRegister", () => {
					const handleKey = (e: KeyboardEvent) => {
						const num = parseInt(e.key, 10);
						if (num >= 1 && num <= 9) {
							// Don't interfere with input fields or while replying
							const tag = (e.target as HTMLElement)?.tagName;
							if (tag === "INPUT" || tag === "TEXTAREA") return;
							if (replyComposerEl) return;
							lb.pswp?.goTo(num - 1);
						}
					};
					document.addEventListener("keydown", handleKey);
					cleanups.push(() =>
						document.removeEventListener("keydown", handleKey),
					);
				});

				lb.on("closingAnimationEnd", () => {
					albumState = { status: "idle" };
				});

				lb.on("destroy", () => {
					if (replyComposerInstance && lb.pswp) {
						closeReplyComposer(lb.pswp);
					}
					cleanups.forEach((fn) => fn());
					cleanups.length = 0;
				});

				lb.init();
				lb.loadAndOpen(0);
			})
			.catch((error: unknown) => {
				console.error("Failed to initialise PhotoSwipe", error);
				showErrorToast({
					label: "Failed to open album viewer",
					error,
				});
				albumState = { status: "idle" };
			});

		return () => {
			cancelled = true;
			cleanups.forEach((fn) => fn());
			cleanups.length = 0;
			lightbox?.destroy();
			lightbox = undefined;
		};
	});
</script>

{#if message.isViewable}
	<button
		class={[
			className,
			contentClass,
			{
				"cursor-pointer": albumState.status === "idle" || albumState.status === "error",
				"overflow-hidden": albumState.status === "loading",
			},
		]}
		onclick={openAlbum}
		disabled={albumState.status === "loading" || albumState.status === "open"}
		bind:this={media.el}
	>
		{#if message.coverUrl !== null}
			<img
				src={message.coverUrl}
				alt=""
				class="absolute top-0 left-0 h-full w-full rounded-[inherit] bg-card-foreground/10 object-cover"
				draggable="false"
			/>
		{:else}
			<div
				class="flex size-full items-center justify-center rounded-[inherit] bg-card-foreground/20"
			>
				<ImageBrokenIcon
					weight="fill"
					class="aspect-square w-8 h-auto"
					color="var(--color-neutral-600)"
				/>
			</div>
		{/if}

		<!-- Shimmer overlay during loading -->
		{#if albumState.status === "loading"}
			<div
				class="absolute inset-0 rounded-[inherit] shimmer-overlay"
				aria-hidden="true"
			></div>
		{/if}

		<!-- Error state overlay -->
		{#if albumState.status === "error"}
			<div
				class="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/40"
			>
				<div class="text-center px-3">
					<div class="text-xs text-red-400 font-medium mb-1">Failed to load</div>
					<span
						class="text-xs text-accent underline cursor-pointer"
						role="button"
						tabindex="0"
						onclick={(e) => { e.stopPropagation(); retryLoad(); }}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); retryLoad(); } }}
					>
						Tap to retry
					</span>
				</div>
			</div>
		{/if}

		<div class={["@container absolute top-0 left-0 size-full", contentClass]}>
			<!-- Gradient overlay for the media type icons -->
			<div
				class="absolute bottom-0 left-0 right-0 h-1/2 rounded-[inherit] bg-gradient-to-t from-black/50 to-transparent pointer-events-none"
				aria-hidden="true"
			></div>
			<div
				class="absolute bottom-1/5 left-1/2 flex -translate-x-1/2 items-center gap-1 px-2 py-0.5 *:aspect-square *:w-[20cqw] *:rounded-full *:bg-card/90 *:p-2 *:backdrop-blur-sm"
			>
				{#if message.hasPhoto}
					<div>
						<ImagesIcon
							width="100%"
							height="auto"
							weight="fill"
							color="var(--color-neutral-200)"
						/>
					</div>
				{/if}
				{#if message.hasVideo}
					<div>
						<VideoIcon
							width="100%"
							height="auto"
							weight="fill"
							color="var(--color-neutral-200)"
						/>
					</div>
				{/if}
			</div>
		</div>
		{@render media.adornments?.()}
	</button>
{:else}
	<div class={[className, contentClass]} bind:this={media.el}>
		<LockedMedia class={media.cornerClass} />
		{@render media.adornments?.()}
	</div>
{/if}

<style>
	:global(.pswp__img) {
		object-fit: contain;
	}

	/* Hide default PhotoSwipe UI elements */
	:global(.pswp__counter) {
		display: none !important;
	}
	:global(.pswp__button--close) {
		display: none !important;
	}
	:global(.pswp__button--zoom) {
		display: none !important;
	}

	/* ---- Loading shimmer ---- */
	.shimmer-overlay {
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.06) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.6s ease-in-out infinite;
		z-index: 1;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* ---- Album footer ---- */
	:global(.pswp__chat-album-footer) {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 14px 10px 14px;
		padding-bottom: env(safe-area-inset-bottom, 8px);
		background: rgba(255, 255, 255, 0.02);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		color: var(--foreground);
		font-size: 0.82rem;
		line-height: 1.2;
		z-index: 20;
	}

	:global(.pswp__chat-album-footer-profile) {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex-shrink: 1;
	}

	:global(.pswp__chat-album-footer-avatar) {
		border-radius: 9999px;
		overflow: hidden;
		flex-shrink: 0;
		background: rgba(255, 255, 255, 0.08);
		display: grid;
		place-items: center;
        margin-bottom: 2px;
	}

	:global(.pswp__chat-album-footer-avatar img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	:global(.pswp__chat-album-footer-avatar-placeholder) {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		color: var(--color-stone-300);
		font-weight: 700;
		background: rgba(255, 255, 255, 0.08);
	}

	:global(.pswp__chat-album-footer-profile-details) {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}

	:global(.pswp__chat-album-footer-profile-name) {
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 120px;
	}

	:global(.pswp__chat-album-footer-album-name) {
		font-size: 0.75rem;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 120px;
	}

	:global(.pswp__chat-album-footer-meta) {
		font-size: 0.65rem;
		color: var(--color-stone-400);
		margin-top: 1px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 120px;
	}

	:global(.pswp__chat-album-footer-counter-stack) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 80px;
		flex-shrink: 0;
	}

	:global(.pswp__chat-album-footer-pill-row) {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		overflow: visible;
		padding: 4px 6px;
	}

	:global(.pswp__chat-album-footer-pill) {
		width: 10px;
		height: 10px;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.12);
		flex-shrink: 0;
		transition: width 240ms cubic-bezier(0.34, 1.56, 0.64, 1),
			background 240ms ease, opacity 240ms ease,
			transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	:global(.pswp__chat-album-footer-pill--viewed) {
		background: rgba(255, 255, 255, 0.28);
	}

	:global(.pswp__chat-album-footer-pill--active) {
		width: 16px;
		height: 10px;
		background: rgba(255, 255, 255, 0.95);
		transform: translateY(-1px) scale(1.1);
		box-shadow: 0 0 6px rgba(255, 255, 255, 0.35);
	}

	:global(.pswp__chat-album-footer-counter) {
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-align: center;
		color: var(--foreground);
		tab-size: 1;
	}

	/* ---- Action wheel styles ---- */
	:global(.pswp__chat-album-footer-actions) {
		display: flex;
		align-items: center;
		position: relative;
	}

	:global(.pswp__chat-album-footer-action-button) {
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.05);
		color: inherit;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		cursor: pointer;
		display: grid;
		place-items: center;
		font-size: 1.15rem;
		transition: background 180ms ease, border-color 180ms ease,
			transform 180ms ease;
		position: relative;
		z-index: 4;
	}

	:global(.pswp__chat-album-footer-actions--open)
		:global(.pswp__chat-album-footer-action-button) {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.24);
	}

	:global(.pswp__chat-album-footer-wheel) {
		position: absolute;
		right: 50%;
		bottom: 50%;
		transform: translate(50%, 50%);
		width: var(--wheel-size, 280px);
		height: var(--wheel-size, 280px);
		pointer-events: none;
		z-index: 1;
	}

	:global(.pswp__chat-album-footer-wheel-hint) {
		position: absolute;
		top: calc(-1 * var(--wheel-radius, 140px));
		left: 50%;
		transform: translate(-50%, -80%);
		padding: 8px 12px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.96);
		color: var(--foreground);
		font-size: 0.78rem;
		letter-spacing: 0.01em;
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transition: opacity 180ms ease, transform 180ms ease;
	}

	:global(.pswp__chat-album-footer-actions--open)
		:global(.pswp__chat-album-footer-wheel-hint) {
		opacity: 1;
		transform: translate(-50%, -100%);
	}

	:global(.pswp__chat-album-footer-wheel-slice) {
		position: absolute;
		width: 100%;
		height: 100%;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		pointer-events: auto;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 0;
		padding: 0;
		clip-path: var(
			--slice-clip-path,
			polygon(50% 50%, 100% 50%, 100% 100%, 50% 50%)
		);
		transition: background 180ms ease;
	}

	:global(.pswp__chat-album-footer-wheel-slice:hover),
	:global(.pswp__chat-album-footer-wheel-slice--active) {
		background: rgba(255, 255, 255, 0.12);
	}

	:global(.pswp__chat-album-footer-wheel-slice--active) {
		background: rgba(255, 255, 255, 0.18);
	}

	:global(.pswp__chat-album-footer-wheel-slice:disabled) {
		opacity: 0.35;
		cursor: not-allowed;
	}

	:global(.pswp__chat-album-footer-wheel-slice-icon) {
		position: absolute;
		font-size: 1.3rem;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		left: calc(50% + var(--icon-x, 0px));
		top: calc(50% + var(--icon-y, 0px));
		transform: translate(-50%, -50%);
		pointer-events: none;
		user-select: none;
	}

	/* ---- In-lightbox reply composer ---- */
	:global(.pswp__album-reply-composer) {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		display: flex;
		flex-direction: row;
		align-items: flex-end;
        justify-items: center;
		gap: 8px;
        height: fit-content;
		padding: 8px 12px 12px 12px;
		padding-bottom: calc(env(safe-area-inset-bottom, 8px) + 4px);
		background: rgba(255, 255, 255, 0.02);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	/* The mounted MessageComposer fills the remaining space */
	:global(.pswp__album-reply-composer > :first-child) {
		flex: 1;
		min-width: 0;
	}

	:global(.pswp__album-reply-composer-close) {
		flex-shrink: 0;
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: rgba(255, 255, 255, 0.05);
		color: inherit;
		width: 40px;
		height: 40px;
		border-radius: 999px;
		cursor: pointer;
		display: grid;
		place-items: center;
		font-size: 0.95rem;
		line-height: 1;
		transition: background 180ms ease, border-color 180ms ease;
	}

	:global(.pswp__album-reply-composer-close:hover) {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.24);
	}
</style>
