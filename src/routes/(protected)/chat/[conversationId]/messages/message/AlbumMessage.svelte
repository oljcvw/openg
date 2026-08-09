<script lang="ts">
	import "photoswipe/style.css";
	import { goto } from "$app/navigation";
	import {
		ClockIcon,
		ImageBrokenIcon,
		ImagesIcon,
		VideoIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import type PhotoSwipeLightbox from "photoswipe/lightbox";

	import { ApiError } from "$lib/api";
	import { getAccountSessionSnapshot } from "$lib/api/account-caches";
	import { showErrorToast } from "$lib/api/error";
	import {
		type AlbumContentResponse,
		getAlbumContent,
		recordAlbumContentView,
	} from "$lib/api/messaging/albums";
	import {
		type CachedAlbumRecord,
		discoverSharedAlbum,
		markAlbumUnavailable,
		readCachedAlbum,
		resolveCachedAlbum,
		retainViewedAlbumContent,
		subscribeCachedAlbum,
	} from "$lib/app-data/album-cache";
	import {
		getDeveloperSettingsSnapshot,
		getKeepUnavailableCachedAlbumsSnapshot,
		subscribePreferences,
	} from "$lib/app-data/preferences.svelte";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { observeBackgroundTask } from "$lib/platform/client-diagnostics";
	import { getNow, subscribeNow } from "$lib/util/now.svelte";
	import type { AlbumMessage } from "$lib/model/messaging/messages";
	import { albumExpiry } from "./album-expiry";
	import { preloadAlbumSlides } from "./album-media-preload";
	import LockedMedia from "./LockedMedia.svelte";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		senderProfileId = null,
		peerProfileId = null,
		isOut = true,
	}: {
		message: AlbumMessage["body"];
		senderProfileId?: number | null;
		peerProfileId?: number | null;
		isOut?: boolean;
	} = $props();

	const media = new MessageMediaState();

	const expiry = $derived(albumExpiry(message, getNow()));
	let cachedRecord = $state<CachedAlbumRecord | null>(null);
	let keepUnavailable = $state(getKeepUnavailableCachedAlbumsSnapshot());
	const albumIdentity = $derived.by(() => {
		const accountProfileId = getAccountSessionSnapshot().accountId;
		return accountProfileId === null || message.ownerProfileId === null
			? null
			: {
					accountProfileId,
					ownerProfileId: message.ownerProfileId,
					albumId: message.albumId,
				};
	});

	$effect(() => {
		const identity = albumIdentity;
		const unsubscribeAlbum = identity
			? subscribeCachedAlbum(identity, (record) => (cachedRecord = record))
			: () => {};
		const unsubscribePreferences = subscribePreferences(() => {
			keepUnavailable = getKeepUnavailableCachedAlbumsSnapshot();
		});
		const ownerValidated =
			!isOut &&
			peerProfileId !== null &&
			senderProfileId === peerProfileId &&
			message.ownerProfileId === peerProfileId;
		observeBackgroundTask(
			discoverSharedAlbum({
				albumId: message.albumId,
				ownerProfileId: message.ownerProfileId,
				expirationType: message.expirationType,
				expiresAt: message.viewableUntil ?? message.expiresAt,
				isViewable: message.isViewable,
				ownerValidated,
			}),
			{
				category: "background_task",
				component: "album_message",
				code: "album_discovery_failed",
			},
		);
		return () => {
			unsubscribeAlbum();
			unsubscribePreferences();
		};
	});

	type UnavailableReason = "revoked_or_removed" | "expired" | "views_exhausted";
	const unavailableReason = $derived.by<UnavailableReason | null>(() => {
		if (expiry?.expired) return "expired";
		if (cachedRecord?.access.status === "unavailable")
			return cachedRecord.access.reason;
		if (!message.isViewable) return "views_exhausted";
		return null;
	});
	const cachedItemCount = $derived(cachedRecord?.media.length ?? 0);
	const canOpenCached = $derived(
		unavailableReason !== null && keepUnavailable && cachedItemCount > 0,
	);
	const canOpen = $derived(
		unavailableReason === null ? message.isViewable : canOpenCached,
	);

	function accessLabel(reason: UnavailableReason | null): string | null {
		if (reason === "expired") return "Expired";
		if (reason === "views_exhausted") return "View limit reached";
		if (reason === null) return null;
		return "Access revoked";
	}

	// Only tick the shared clock while an expiring album is on screen.
	$effect(() => {
		if (expiry === null) return;
		return subscribeNow();
	});

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
		| { status: "open"; album: LoadedAlbum };

	let albumState = $state<AlbumState>({ status: "idle" });
	let retainedAlbumSnapshot: { key: string; album: LoadedAlbum } | null = null;
	const retainedSnapshotKey = $derived(
		albumIdentity === null
			? "none"
			: `${albumIdentity.accountProfileId}:${albumIdentity.ownerProfileId}:${albumIdentity.albumId}:${cachedRecord?.lastAccessedAt ?? "none"}:${unavailableReason ?? "available"}:${keepUnavailable}`,
	);

	$effect(() => {
		void retainedSnapshotKey;
		retainedAlbumSnapshot = null;
	});

	function openAlbum() {
		if (!canOpen) {
			toast.info(accessLabel(unavailableReason) ?? "Album unavailable", {
				description:
					cachedItemCount > 0
						? "A cached copy remains on this device. Enable it in App Settings."
						: "No retained media is available on this device.",
				action:
					cachedItemCount > 0
						? {
								label: "App Settings",
								onClick: () => void goto("/settings/app"),
							}
						: undefined,
			});
			return;
		}
		if (
			unavailableReason !== null &&
			retainedAlbumSnapshot?.key === retainedSnapshotKey
		) {
			albumState = { status: "open", album: retainedAlbumSnapshot.album };
		} else {
			albumState = { status: "loading" };
		}
	}

	$effect(() => {
		if (albumState.status !== "loading") return;
		const abortController = new AbortController();
		(async () => {
			let response: AlbumContentResponse;
			let retained = false;
			const snapshotKey = retainedSnapshotKey;
			if (unavailableReason !== null && keepUnavailable && cachedRecord) {
				response = await resolveCachedAlbum(cachedRecord);
				retained = true;
			} else {
				try {
					response = await getAlbumContent(message.albumId, {
						signal: abortController.signal,
					});
				} catch (error) {
					if (
						error instanceof ApiError &&
						error.response?.status === 403 &&
						error.kind !== "RequestBlocked" &&
						error.kind !== "RequestCooldown"
					) {
						if (albumIdentity)
							await markAlbumUnavailable(
								albumIdentity,
								"revoked_or_removed",
							).catch((cacheError) =>
								console.error("Failed to mark cached album", cacheError),
							);
					}
					const cached = albumIdentity
						? await readCachedAlbum(albumIdentity).catch((cacheError) => {
								console.error("Failed to read cached album", cacheError);
								return null;
							})
						: null;
					if (!keepUnavailable || !cached || cached.media.length === 0)
						throw error;
					response = await resolveCachedAlbum(cached).catch((cacheError) => {
						console.error("Failed to resolve cached album", cacheError);
						throw error;
					});
					retained = true;
				}
			}
			const loaded = await preloadForViewer(response, {
				retained,
				signal: abortController.signal,
			});
			if (abortController.signal.aborted) return;
			if (retained) retainedAlbumSnapshot = { key: snapshotKey, album: loaded };
			albumState = { status: "open", album: loaded };
		})().catch((error) => {
			if (abortController.signal.aborted) return;
			console.error(error);
			showErrorToast({
				label: "Failed to load album content",
				error,
			});
			albumState = { status: "idle" };
		});
		return () => abortController.abort();
	});

	$effect(() => {
		if (albumState.status !== "open") return;
		const { album } = albumState;
		let lightbox: PhotoSwipeLightbox | undefined;
		let canceled = false;
		import("photoswipe/lightbox")
			.then(({ default: PhotoSwipeLightbox }) => {
				if (canceled) return;
				lightbox = new PhotoSwipeLightbox({
					showHideAnimationType: "fade",
					pswpModule: () => import("photoswipe"),
					mainClass: `pswp--buttons-visible`,
					loop: false,
					preload: message.expirationType === "ONCE" ? [0, 0] : [1, 2],
				});
				lightbox.addFilter("numItems", () => album.content.length);
				lightbox.addFilter("itemData", (_, index) => {
					const { url, width, height } = album.content[index];
					return url.length > 0
						? { src: url, width, height }
						: {
								html: '<div class="og-album-missing">This item was not cached</div>',
								width: 1,
								height: 1,
							};
				});
				lightbox.addFilter(
					"useContentPlaceholder",
					(usePlaceholder, content) =>
						album.content[content.index]?.contentType.startsWith("video/")
							? false
							: usePlaceholder,
				);
				lightbox.on("uiRegister", () => {
					lightbox?.pswp?.ui?.registerElement({
						name: "album-position",
						order: 7,
						isButton: false,
						appendTo: "wrapper",
						onInit: (element, pswp) => {
							element.setAttribute("role", "status");
							element.setAttribute("aria-live", "polite");
							element.setAttribute("aria-atomic", "true");
							const updatePosition = () => {
								element.textContent = `${pswp.currIndex + 1} / ${pswp.getNumItems()}`;
							};
							updatePosition();
							pswp.on("change", updatePosition);
						},
					});
				});
				const onBackGesture = () => {
					lightbox?.pswp?.close();
					return false;
				};
				lightbox.on("beforeOpen", () => {
					backGestureEventHandlers.add(onBackGesture);
				});
				lightbox.on("close", () => {
					backGestureEventHandlers.delete(onBackGesture);
				});
				lightbox.on("contentLoad", (event) => {
					const { content } = event;
					const slide = album.content[content.index];
					if (slide?.url.length > 0 && slide.contentType.startsWith("video/")) {
						event.preventDefault();
						content.element = document.createElement("div");
						const video = document.createElement("video");
						video.src = slide.url;
						if (slide.coverUrl !== null) video.poster = slide.coverUrl;
						video.controls = true;
						video.playsInline = true;
						video.className = "size-full object-contain";
						content.element.appendChild(video);
						content.state = "loading";
						if (video.readyState >= 3) {
							content.onLoaded();
						} else {
							video.addEventListener("loadeddata", () => content.onLoaded());
							video.addEventListener("error", () => content.onError());
						}
					}
				});
				if (message.expirationType === "ONCE" && unavailableReason === null) {
					const viewed = new Set<number>();
					const recordCurrentView = () => {
						const index = lightbox?.pswp?.currIndex ?? 0;
						const item = album.content[index];
						if (!item || item.url.length === 0 || viewed.has(item.contentId))
							return;
						viewed.add(item.contentId);
						void recordAlbumContentView({
							albumId: album.albumId,
							contentId: item.contentId,
						})
							.then(() =>
								retainViewedAlbumContent(
									{
										albumId: album.albumId,
										ownerProfileId: message.ownerProfileId,
										expirationType: message.expirationType,
										expiresAt: message.viewableUntil ?? message.expiresAt,
									},
									album,
									item.contentId,
								),
							)
							.catch((error) => console.error(error));
					};
					lightbox.on("afterInit", recordCurrentView);
					lightbox.on("change", recordCurrentView);
				}
				if (unavailableReason !== null) {
					lightbox.on("uiRegister", () => {
						lightbox?.pswp?.ui?.registerElement({
							name: "cached-album-status",
							order: 8,
							isButton: false,
							appendTo: "wrapper",
							html: `Cached copy · ${accessLabel(unavailableReason)}`,
						});
					});
				}
				lightbox.on("closingAnimationEnd", () => {
					albumState = { status: "idle" };
				});
				lightbox.init();
				lightbox.loadAndOpen(0);
			})
			.catch((error) => {
				console.error(error);
				showErrorToast({
					label: "Failed to open album",
					error,
				});
				albumState = { status: "idle" };
			});
		return () => {
			canceled = true;
			lightbox?.destroy();
			lightbox = undefined;
		};
	});

	async function preloadForViewer(
		album: AlbumContentResponse,
		options: { retained: boolean; signal: AbortSignal },
	): Promise<LoadedAlbum> {
		const settings = getDeveloperSettingsSnapshot();
		if (!options.retained && message.expirationType !== "ONCE") {
			return {
				...album,
				content: await preloadAlbumSlides(album.content, {
					concurrency: settings.albumPreloadConcurrency,
					timeoutMs: settings.albumPreloadTimeoutMs,
					signal: options.signal,
				}),
			};
		}
		if (!options.retained && message.expirationType === "ONCE") {
			// Preserve the server ordering and URLs for explicit viewer activation,
			// but never speculatively fetch once-view media while preparing slides.
			return {
				...album,
				content: album.content.map((item) => ({
					...item,
					url:
						item.processing === true || item.rejectionId !== null
							? ""
							: item.url,
					width: 1,
					height: 1,
				})),
			};
		}
		const available = options.retained
			? album.content.filter((item) => item.url.length > 0)
			: [];
		const loaded = await preloadAlbumSlides(available, {
			concurrency: settings.albumPreloadConcurrency,
			timeoutMs: settings.albumPreloadTimeoutMs,
			signal: options.signal,
		});
		const loadedById = new Map(loaded.map((item) => [item.contentId, item]));
		return {
			...album,
			content: album.content.map(
				(item) =>
					loadedById.get(item.contentId) ?? { ...item, width: 1, height: 1 },
			),
		};
	}
</script>

{#if canOpen || cachedItemCount > 0}
	<button
		class={[
			className,
			contentClass,
			{
				"cursor-pointer": albumState.status === "idle",
				"opacity-50": albumState.status === "loading",
			},
		]}
		onclick={openAlbum}
		disabled={albumState.status !== "idle"}
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
					class="aspect-square h-auto w-8"
					color="var(--color-neutral-600)"
				/>
			</div>
		{/if}
		<div class={["@container absolute top-0 left-0 size-full", contentClass]}>
			{#if unavailableReason !== null}
				<div
					class="absolute top-1.5 right-1.5 z-10 rounded-full bg-black/75 px-2 py-0.5 text-xs font-medium text-white"
				>
					{accessLabel(unavailableReason)}
				</div>
			{/if}
			{#if expiry !== null}
				<div
					class={[
						"absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white",
						expiry.expired ? "bg-destructive/80" : "bg-black/60",
					]}
				>
					<ClockIcon weight="fill" class="size-3.5 shrink-0" />
					<span class="truncate">{expiry.label}</span>
				</div>
			{/if}
			<div
				class="absolute bottom-1/5 left-1/2 flex -translate-x-1/2 items-center gap-1 px-2 py-0.5 *:aspect-square *:w-[20cqw] *:rounded-full *:bg-card *:p-2"
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
	:global(.pswp__cached-album-status) {
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
	:global(.pswp__album-position) {
		position: absolute;
		top: calc(var(--safe-area-top) + 3rem);
		left: 50%;
		z-index: 21;
		transform: translateX(-50%);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		background: var(--color-card);
		padding: 0.25rem 0.75rem;
		color: var(--color-card-foreground);
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.25rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
	}
	:global(.og-album-missing) {
		display: flex;
		height: 100%;
		width: 100%;
		align-items: center;
		justify-content: center;
		background: var(--color-card);
		color: var(--color-muted-foreground);
	}
</style>
