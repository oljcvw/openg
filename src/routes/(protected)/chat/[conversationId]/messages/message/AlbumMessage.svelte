<script lang="ts">
	import {
		ClockIcon,
		ImageBrokenIcon,
		ImagesIcon,
		VideoIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";

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
	import { getConversationMediaViewer } from "$lib/chat/conversation-media-viewer.svelte";
	import { openAppDetail } from "$lib/navigation/app-navigation";
	import { observeBackgroundTask } from "$lib/platform/client-diagnostics";
	import { getNow, subscribeNow } from "$lib/util/now.svelte";
	import type { AlbumMessage } from "$lib/model/messaging/messages";
	import { albumExpiry } from "./album-expiry";
	import { preloadAlbumSlides } from "./album-media-preload";
	import LockedMedia from "./LockedMedia.svelte";
	import { MessageMediaState } from "./message-media.svelte";

	let {
		message,
		messageId,
		senderProfileId = null,
		peerProfileId = null,
		isOut = true,
	}: {
		message: AlbumMessage["body"];
		messageId: string;
		senderProfileId?: number | null;
		peerProfileId?: number | null;
		isOut?: boolean;
	} = $props();

	const media = new MessageMediaState();
	const viewer = getConversationMediaViewer()();

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

	type LoadedAlbum = Omit<AlbumContentResponse, "content"> & {
		content: (AlbumContentResponse["content"][number] & {
			width: number;
			height: number;
		})[];
	};

	let loading = $state(false);
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

	function openAlbum(opener: HTMLButtonElement) {
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
								onClick: () => void openAppDetail("/settings/app"),
							}
						: undefined,
			});
			return;
		}
		if (loading) return;
		loading = true;
		void viewer
			.openExplicit({
				messageId,
				opener,
				resolve: resolveViewerSession,
			})
			.catch((error) => {
				if (error instanceof DOMException && error.name === "AbortError")
					return;
				console.error(error);
				showErrorToast({ label: "Failed to load album content", error });
			})
			.finally(() => (loading = false));
	}

	async function resolveViewerSession(signal: AbortSignal) {
		if (
			unavailableReason !== null &&
			retainedAlbumSnapshot?.key === retainedSnapshotKey
		) {
			return albumViewerSession(retainedAlbumSnapshot.album);
		}
		let response: AlbumContentResponse;
		let retained = false;
		const snapshotKey = retainedSnapshotKey;
		if (unavailableReason !== null && keepUnavailable && cachedRecord) {
			response = await resolveCachedAlbum(cachedRecord);
			retained = true;
		} else {
			try {
				response = await getAlbumContent(message.albumId, {
					signal,
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
			signal,
		});
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		if (retained) retainedAlbumSnapshot = { key: snapshotKey, album: loaded };
		return albumViewerSession(loaded);
	}

	function albumViewerSession(album: LoadedAlbum) {
		const viewed = new Set<number>();
		return {
			items: album.content.map((item) => ({
				id: String(item.contentId),
				kind: item.contentType.startsWith("video/")
					? ("video" as const)
					: ("image" as const),
				url: item.url.length > 0 ? item.url : null,
				width: item.width,
				height: item.height,
				poster: item.coverUrl,
				unavailableLabel: "This item was not cached",
			})),
			startId: String(album.content[0]?.contentId ?? ""),
			preload:
				message.expirationType === "ONCE"
					? ([0, 0] as [number, number])
					: ([1, 2] as [number, number]),
			statusLabel:
				unavailableReason === null
					? null
					: `Cached copy · ${accessLabel(unavailableReason)}`,
			onItemActivate:
				message.expirationType === "ONCE" && unavailableReason === null
					? (_item: unknown, index: number) => {
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
						}
					: undefined,
		};
	}

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
				"cursor-pointer": !loading,
				"opacity-50": loading,
			},
		]}
		onclick={(event) => openAlbum(event.currentTarget)}
		disabled={loading}
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
