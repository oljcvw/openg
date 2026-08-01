<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { tick, untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import { recordProfileView } from "$lib/api/interest/views";
	import {
		BlockedProfileError,
		getPersistedProfile,
		getProfile,
		mergeProfileEditIntoCaches,
		ProfileUnavailableError,
		refreshProfile,
	} from "$lib/api/users/profiles";
	import {
		getPreferences,
		getProfileSwipeNavigationSnapshot,
	} from "$lib/app-data/preferences.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import NotFound from "$lib/components/feedback/NotFound.svelte";
	import { PullModel } from "$lib/components/feedback/refresh/pull-model.svelte";
	import { attachTouchPull } from "$lib/components/feedback/refresh/touch-adapter";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		isProfileSwipeInteractiveTarget,
		type ProfileNavigationDirection,
		selectProfileForHorizontalSwipe,
		selectProfileForNavigationKey,
	} from "$lib/grid/profile-navigation";
	import type { Profile } from "$lib/model/users/profiles";
	import AboutMe from "./AboutMe.svelte";
	import BlockedProfile from "./BlockedProfile.svelte";
	import ProfileBottomNavBar from "./bottom-nav/ProfileBottomNavBar.svelte";
	import Distance from "./Distance.svelte";
	import FavoriteNote from "./FavoriteNote.svelte";
	import Ethnicity from "./fields/Ethnicity.svelte";
	import Genders from "./fields/GendersPronouns.svelte";
	import HealthPractices from "./fields/HealthPractices.svelte";
	import HivStatus from "./fields/HivStatus.svelte";
	import LastTested from "./fields/LastTested.svelte";
	import LookingFor from "./fields/LookingFor.svelte";
	import MeetAt from "./fields/MeetAt.svelte";
	import NSFWPics from "./fields/NSFWPics.svelte";
	import RelationshipStatus from "./fields/RelationshipStatus.svelte";
	import Socials from "./fields/Socials.svelte";
	import Tribes from "./fields/Tribes.svelte";
	import Height from "./HeightWeightBodyType.svelte";
	import ImageCarousel from "./ImageCarousel.svelte";
	import OnlineStatus from "./OnlineStatus.svelte";
	import { waitForProfileDismissAnimations } from "./profile-dismiss";
	import ProfileAlbums from "./ProfileAlbums.svelte";
	import ProfileTags from "./ProfileTags.svelte";
	import SexualPosition from "./SexualPosition.svelte";
	import ProfileTopNavBar from "./top-nav/ProfileTopNavBar.svelte";

	let { data }: import("./$types").PageProps = $props();

	const ourProfileId = $derived(data.ourProfileId);
	const profileId = $derived(Number(page.params.profileId));

	let profileScrollShell = $state<HTMLElement | null>(null);
	let profileMain = $state<HTMLElement | null>(null);
	let profilePhotoPane = $state<HTMLElement | null>(null);
	let profileScrollTop = $state(0);
	let profilePhotoHeight = $state(0);
	let profile = $state<Profile | null>(null);
	let loading = $state(true);
	let loadError = $state<Error | null>(null);
	let navigationBusy = $state(false);
	let swipeOffsetX = $state(0);
	let swipeSettling = $state(false);
	let pendingEntryDirection = $state<ProfileNavigationDirection | null>(null);
	let dismissClosing = $state(false);
	let dismissReturning = $state(false);
	let dismissExitY = $state(0);
	let suppressProfileClick = false;

	const dismissModel = new PullModel();
	dismissModel.space = 96;

	const browseNavigation = $derived(
		page.url.searchParams.get("from") === "browse" &&
			gridState.items.some(({ id }) => id === profileId),
	);
	const profileNavigation = $derived(
		browseNavigation
			? gridState.getProfileNavigation(profileId)
			: { nextProfileId: null, previousProfileId: null },
	);
	const canNavigateNext = $derived(
		browseNavigation &&
			(profileNavigation.nextProfileId !== null || gridState.hasMoreProfiles),
	);
	const canNavigatePrevious = $derived(
		browseNavigation && profileNavigation.previousProfileId !== null,
	);
	const profileSwipeNavigationEnabled = $derived(
		getProfileSwipeNavigationSnapshot(),
	);
	const swipeOpacity = $derived(
		Math.max(0.45, 1 - Math.min(Math.abs(swipeOffsetX), 240) / 480),
	);
	const dismissOffsetY = $derived(
		dismissClosing ? dismissExitY : dismissModel.displayPx,
	);
	const dismissProgress = $derived(
		Math.min(1, dismissOffsetY / Math.max(dismissModel.space, 1)),
	);
	const dismissScale = $derived(1 - dismissProgress * 0.035);
	const dismissRadius = $derived(dismissProgress * 28);
	const dismissSettling = $derived(dismissClosing || dismissReturning);
	const showCompactHeader = $derived(
		profilePhotoHeight > 0 && profileScrollTop >= profilePhotoHeight - 16,
	);

	async function loadProfile(id: number) {
		loading = true;
		loadError = null;
		profile = null;
		try {
			const cached = await getPersistedProfile(id);
			if (id !== profileId) return;
			if (cached) {
				profile = cached;
				loading = false;
			}
			const result = cached ? await refreshProfile(id) : await getProfile(id);
			if (id !== profileId) return;
			profile = result;
			loadError = null;
		} catch (error) {
			if (id !== profileId) return;
			if (profile) {
				showErrorToast({ label: "Failed to refresh profile", error });
				return;
			}
			loadError = error instanceof Error ? error : new Error(String(error));
			profile = null;
		} finally {
			if (id === profileId) {
				loading = false;
			}
		}
	}

	$effect(() => {
		const id = profileId;
		if (!Number.isFinite(id)) return;
		if (untrack(() => pendingEntryDirection) === null) {
			swipeOffsetX = 0;
			swipeSettling = false;
		}
		profileScrollTop = 0;
		void loadProfile(id);
	});

	const ourProfile = $derived(profileId === ourProfileId);

	$effect(() => {
		const id = profileId;
		if (!Number.isFinite(id) || ourProfile) return;
		void (async () => {
			try {
				const { revealProfileViews } = await getPreferences();
				if (!revealProfileViews) return;
				await recordProfileView({ profileId: id });
			} catch (error) {
				console.error(error);
				showErrorToast({
					label: "Failed to record profile view preference or action",
					error,
				});
			}
		})();
	});

	let optimisticBlockProfileId = $state<number | null>(null);
	const optimisticallyBlocked = $derived(
		optimisticBlockProfileId === profileId,
	);

	let swipeStart = $state<{
		pointerId: number;
		x: number;
		y: number;
		startedAt: number;
		axis: "pending" | "horizontal" | "vertical";
	} | null>(null);

	function reducedMotionPreferred() {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	function resetSwipe() {
		swipeStart = null;
		swipeOffsetX = 0;
		swipeSettling = false;
	}

	function closeProfile() {
		if (window.navigation?.canGoBack ?? history.length > 1) history.back();
		else void goto("/", { replaceState: true });
	}

	async function finishAnimatedProfileClose() {
		await tick();
		const element = profileMain;
		if (!dismissClosing || !element) return;
		await waitForProfileDismissAnimations(() => element.getAnimations());
		if (dismissClosing) closeProfile();
	}

	function animateProfileClose() {
		if (dismissClosing) return;
		dismissClosing = true;
		if (reducedMotionPreferred()) {
			closeProfile();
			return;
		}
		dismissExitY = Math.max(window.innerHeight * 1.08, 640);
		void finishAnimatedProfileClose();
	}

	dismissModel.onTrigger = () => void animateProfileClose();

	$effect(() => {
		const container = profileScrollShell;
		if (!container || dismissClosing) return;
		return attachTouchPull(dismissModel, {
			listenTarget: container,
			scrollRoot: () => container,
			boundaryDistance: () => container.scrollTop,
			position: "top",
			canStart: (target) => !isProfileSwipeInteractiveTarget(target),
			primaryAxisRatio: 1.25,
			requireBoundaryAtStart: true,
		});
	});

	$effect(() => {
		if (dismissModel.settledOutcome !== "canceled") return;
		dismissReturning = true;
		const timer = window.setTimeout(() => {
			dismissReturning = false;
		}, 170);
		return () => {
			window.clearTimeout(timer);
			dismissReturning = false;
		};
	});

	$effect(() => {
		const pane = profilePhotoPane;
		if (!pane) return;
		const measure = () => {
			profilePhotoHeight = pane.offsetHeight;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(pane);
		return () => observer.disconnect();
	});

	$effect(() => {
		const captureSwipeClick = (event: MouseEvent) => {
			if (!suppressProfileClick) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			suppressProfileClick = false;
		};
		window.addEventListener("click", captureSwipeClick, true);
		return () => window.removeEventListener("click", captureSwipeClick, true);
	});

	function rubberBandOffset(deltaX: number) {
		const absX = Math.abs(deltaX);
		if (absX <= 160) return deltaX;
		return Math.sign(deltaX) * (160 + (absX - 160) * 0.2);
	}

	async function navigateToAdjacent(direction: ProfileNavigationDirection) {
		if (!browseNavigation || navigationBusy) return;
		navigationBusy = true;

		try {
			const targetProfileId = await gridState.getAdjacentProfileId(
				profileId,
				direction,
			);
			if (targetProfileId === null) {
				swipeSettling = true;
				swipeOffsetX = 0;
				return;
			}

			try {
				await getProfile(targetProfileId);
			} catch (error) {
				if (
					!(error instanceof BlockedProfileError) &&
					!(error instanceof ProfileUnavailableError)
				)
					throw error;
			}
			const reducedMotion = reducedMotionPreferred();
			const directionSign = direction === "next" ? -1 : 1;

			if (!reducedMotion) {
				swipeSettling = true;
				swipeOffsetX = directionSign * Math.max(window.innerWidth, 320);
				await new Promise((resolve) => window.setTimeout(resolve, 170));
			}

			pendingEntryDirection = direction;
			await goto(`/profile/${targetProfileId}?from=browse`, {
				replaceState: true,
				noScroll: true,
				keepFocus: true,
			});
			profileScrollShell?.scrollTo({ top: 0, behavior: "auto" });

			if (!reducedMotion) {
				swipeSettling = false;
				swipeOffsetX = direction === "next" ? 72 : -72;
				await tick();
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => {
						requestAnimationFrame(() => resolve());
					});
				});
				swipeSettling = true;
				swipeOffsetX = 0;
				await new Promise((resolve) => window.setTimeout(resolve, 170));
			}
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to open adjacent profile",
				error,
			});
			swipeSettling = true;
			swipeOffsetX = 0;
		} finally {
			pendingEntryDirection = null;
			navigationBusy = false;
		}
	}

	function handleProfilePointerDown(event: PointerEvent) {
		if (!browseNavigation || !profileSwipeNavigationEnabled || navigationBusy)
			return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		if (event.clientX <= 24 || isProfileSwipeInteractiveTarget(event.target))
			return;

		dismissReturning = false;
		swipeSettling = false;
		swipeOffsetX = 0;
		swipeStart = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			startedAt: performance.now(),
			axis: "pending",
		};
	}

	function handleProfilePointerMove(event: PointerEvent) {
		if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - swipeStart.x;
		const deltaY = event.clientY - swipeStart.y;

		if (swipeStart.axis === "pending") {
			if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
			swipeStart.axis =
				Math.abs(deltaX) > Math.abs(deltaY) * 1.1 ? "horizontal" : "vertical";
		}
		if (swipeStart.axis !== "horizontal") return;

		event.preventDefault();
		suppressProfileClick = true;
		swipeOffsetX = rubberBandOffset(deltaX);
	}

	function handleProfilePointerUp(event: PointerEvent) {
		if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
		const start = swipeStart;
		swipeStart = null;
		if (start.axis !== "horizontal") return;
		window.setTimeout(() => {
			suppressProfileClick = false;
		}, 0);

		const selection = selectProfileForHorizontalSwipe({
			...profileNavigation,
			deltaX: event.clientX - start.x,
			deltaY: event.clientY - start.y,
			elapsedMs: performance.now() - start.startedAt,
			startX: start.x,
		});

		if (selection === null) {
			swipeSettling = true;
			swipeOffsetX = 0;
			return;
		}
		void navigateToAdjacent(selection.direction);
	}

	function handleProfilePointerCancel(event: PointerEvent) {
		if (swipeStart?.pointerId !== event.pointerId) return;
		suppressProfileClick = false;
		resetSwipe();
	}

	function handleProfileKeyDown(event: KeyboardEvent) {
		if (
			!browseNavigation ||
			navigationBusy ||
			event.repeat ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			isProfileSwipeInteractiveTarget(event.target)
		)
			return;

		const direction = selectProfileForNavigationKey({
			canNavigateNext,
			canNavigatePrevious,
			enabled: profileSwipeNavigationEnabled,
			key: event.key,
		});
		if (direction === null) return;
		event.preventDefault();
		void navigateToAdjacent(direction);
	}
</script>

<svelte:window
	onkeydown={handleProfileKeyDown}
	onpointercancel={handleProfilePointerCancel}
	onpointerdown={handleProfilePointerDown}
	onpointermove={handleProfilePointerMove}
	onpointerup={handleProfilePointerUp}
/>

{#if optimisticallyBlocked}
	<div class="flex flex-1">
		<BlockedProfile
			blockedByUs={true}
			onRefresh={() => {
				optimisticBlockProfileId = null;
			}}
		/>
	</div>
{:else if loadError instanceof BlockedProfileError}
	<div class="flex flex-1">
		<BlockedProfile
			blockedByUs={loadError.blockedByUs}
			onRefresh={() => void loadProfile(profileId)}
		/>
	</div>
{:else if loadError instanceof ProfileUnavailableError}
	<div class="flex flex-1">
		<NotFound />
	</div>
{:else if loadError}
	<div class="flex flex-1">
		<ApiErrorDisplay
			error={loadError}
			onRetry={() => void loadProfile(profileId)}
			class="m-auto"
		/>
	</div>
{:else}
	<div
		class="relative -mb-(--nav-height) h-screen-safe overflow-hidden bg-linear-to-b from-accent/20 via-background to-background"
	>
		<div
			aria-hidden="true"
			class="pointer-events-none absolute inset-x-0 top-0 z-0 flex h-24 items-center justify-center text-sm font-medium transition-opacity motion-reduce:transition-none"
			style:opacity={dismissModel.gestureActive || dismissClosing
				? Math.min(1, dismissProgress * 1.35)
				: 0}
		>
			{dismissModel.phase === "armed" || dismissClosing
				? "Release to close"
				: "Pull down to close"}
		</div>
		<div
			class="relative z-10 h-full overflow-y-auto overscroll-contain"
			bind:this={profileScrollShell}
			data-profile-scroll-shell
			onscroll={(event) => {
				profileScrollTop = event.currentTarget.scrollTop;
			}}
		>
			<main
				bind:this={profileMain}
				class={[
					"relative mx-auto min-h-overscrollable w-full max-w-200 touch-pan-y overflow-hidden bg-background will-change-transform",
					{
						"transition-[transform,opacity,border-radius,box-shadow] motion-reduce:transition-none":
							swipeSettling || dismissSettling,
						"shadow-2xl": dismissProgress > 0,
					},
				]}
				style:border-radius={`${dismissRadius}px ${dismissRadius}px 0 0`}
				style:opacity={swipeOpacity}
				style:transform={`translate3d(${swipeOffsetX}px, ${dismissOffsetY}px, 0) scale(${dismissScale})`}
				style:transform-origin="top center"
				style:transition-duration={dismissClosing ? "280ms" : "170ms"}
				style:transition-timing-function="cubic-bezier(0.2, 0.85, 0.25, 1)"
			>
				{#if loading || !profile}
					<div
						class="relative w-full"
						bind:this={profilePhotoPane}
						data-profile-photo-pane
						style:height="calc(var(--screen-safe) * 0.7)"
					>
						<Skeleton class="size-full rounded-none" />
					</div>
					<div
						class={[
							"flex max-w-full flex-col gap-3.5 p-4",
							{
								"pb-24": ourProfile,
								"pb-40": !ourProfile,
							},
						]}
						data-profile-details
					>
						<Skeleton class="h-6 w-40 max-w-full" />
						<Skeleton class="h-3 w-30 max-w-full" />
						<Skeleton class="mt-0.5 h-3 w-50 max-w-full" />
						<div class="mt-2 flex flex-wrap gap-1">
							{#each [10, 12, 18, 16, 15] as w}
								<Skeleton
									class="h-4.5 w-(--w)"
									--w="calc(var(--spacing) * {w})"
								/>
							{/each}
						</div>
						<Skeleton class="mt-2.25 h-27 w-full rounded-4xl" />
					</div>
				{:else}
					{@const {
						displayName,
						age,
						onlineUntil,
						seen,
						distance,
						sexualPosition,
						height,
						weight,
						bodyType,
						profileTags,
						aboutMe,
						genders,
						pronouns,
						ethnicity,
						relationshipStatus,
						grindrTribes,
						lookingFor,
						meetAt,
						nsfw,
						hivStatus,
						lastTestedDate: lastTestedDateValue,
						sexualHealth: sexualHealthValue,
						socialNetworks,
						medias,
					} = profile}
					<div
						class="relative"
						bind:this={profilePhotoPane}
						data-profile-photo-pane
					>
						<ImageCarousel {medias} />
						<ProfileTopNavBar
							{ourProfileId}
							{profile}
							hiddenFromAccessibility={showCompactHeader}
							onBack={closeProfile}
							onBlocked={() => {
								optimisticBlockProfileId = profileId;
							}}
						/>
					</div>
					<div
						class={[
							"flex flex-col p-4",
							{
								"pb-24": ourProfile,
								"pb-40": !ourProfile,
							},
						]}
						data-profile-details
					>
						<h1 class="text-2xl wrap-break-word">
							{#if displayName !== null}
								<span class="font-semibold">
									{displayName}
								</span>{:else}<span
									class="font-normal tracking-tight text-muted-foreground italic"
								>
									Someone
								</span>{/if}{#if age !== null}, {age}
							{/if}
						</h1>
						<div class="mt-1 flex items-center gap-3 text-sm">
							<OnlineStatus
								onlineUntil={onlineUntil ?? null}
								{seen}
								self={ourProfile}
							/>
							<Distance {distance} />
						</div>
						{#if sexualPosition !== null || height !== null || weight !== null || bodyType !== null}
							<div class="mt-2 flex items-center gap-3 text-sm">
								{#if sexualPosition !== null && sexualPosition !== undefined}
									<SexualPosition {sexualPosition} />
								{/if}
								<Height {height} {weight} {bodyType} />
							</div>
						{/if}
						<ProfileTags tags={profileTags} />
						<FavoriteNote
							accountProfileId={ourProfileId}
							{profileId}
							isFavorite={profile.isFavorite}
						/>
						{#if aboutMe !== null}
							<AboutMe>{aboutMe}</AboutMe>
						{/if}
						{#if (genders && genders.length > 0) || (pronouns && pronouns.length > 0) || ethnicity !== null || relationshipStatus !== null || (grindrTribes && grindrTribes.length > 0)}
							<div class="mt-4 flex flex-col gap-2">
								<span class="text-sm text-muted-foreground uppercase"
									>Stats</span
								>
								<Genders {genders} {pronouns} />
								<Tribes tribes={grindrTribes} />
								<Ethnicity {ethnicity} />
								<RelationshipStatus {relationshipStatus} />
							</div>
						{/if}
						{#if (lookingFor && lookingFor.length > 0) || (meetAt && meetAt.length > 0) || nsfw !== null}
							<div class="mt-4 flex flex-col gap-2">
								<span class="text-sm text-muted-foreground uppercase">
									Expectations
								</span>
								<LookingFor {lookingFor} />
								<MeetAt {meetAt} />
								<NSFWPics nsfwPics={nsfw} />
							</div>
						{/if}
						<ProfileAlbums {profileId} self={ourProfile} />
						{#if hivStatus !== null || lastTestedDateValue !== null || (sexualHealthValue && sexualHealthValue.length > 0)}
							<div class="mt-4 flex flex-col gap-2">
								<span class="text-sm text-muted-foreground uppercase">
									Health
								</span>
								<HivStatus {hivStatus} />
								<LastTested lastTestedDate={lastTestedDateValue} />
								<HealthPractices healthPractices={sexualHealthValue} />
							</div>
						{/if}
						{#if socialNetworks && Object.keys(socialNetworks).length > 0}
							<div class="mt-4 flex flex-col gap-2">
								<span class="text-sm text-muted-foreground uppercase">
									Socials
								</span>
								<Socials socials={socialNetworks} />
							</div>
						{/if}
					</div>
				{/if}
			</main>
		</div>
		{#if profile}
			<ProfileTopNavBar
				{ourProfileId}
				{profile}
				compact
				hiddenFromAccessibility={!showCompactHeader}
				onBack={closeProfile}
				onBlocked={() => {
					optimisticBlockProfileId = profileId;
				}}
				class={[
					"transition-[opacity,transform] duration-150 motion-reduce:transition-none",
					{
						"pointer-events-auto translate-y-0 opacity-100": showCompactHeader,
						"pointer-events-none -translate-y-3 opacity-0": !showCompactHeader,
					},
				]}
			/>
			<ProfileBottomNavBar
				{ourProfileId}
				{profileId}
				{dismissOffsetY}
				{dismissSettling}
				{dismissClosing}
				tapType={profile.tapType}
				onTap={(tapType) => {
					if (!profile) return;
					const tapped = tapType !== null;
					profile.tapType = tapType;
					profile.tapped = tapped;
					mergeProfileEditIntoCaches(profile.profileId, {
						tapType,
						tapped,
					});
				}}
			/>
		{/if}
	</div>
{/if}
