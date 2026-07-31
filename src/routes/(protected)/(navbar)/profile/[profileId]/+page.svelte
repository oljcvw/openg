<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { CaretLeftIcon, CaretRightIcon } from "phosphor-svelte";
	import { tick, untrack } from "svelte";

	import { showErrorToast } from "$lib/api/error";
	import { recordProfileView } from "$lib/api/interest/views";
	import {
		BlockedProfileError,
		getProfile,
		invalidateProfile,
		mergeProfileEditIntoCaches,
		ProfileUnavailableError,
	} from "$lib/api/users/profiles";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import ApiErrorDisplay from "$lib/components/feedback/ApiErrorDisplay.svelte";
	import DataRefreshControl from "$lib/components/feedback/DataRefreshControl.svelte";
	import NotFound from "$lib/components/feedback/NotFound.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton";
	import { gridState } from "$lib/grid/grid-state.svelte";
	import {
		isProfileSwipeInteractiveTarget,
		type ProfileNavigationDirection,
		selectProfileForHorizontalSwipe,
	} from "$lib/grid/profile-navigation";
	import type { Profile } from "$lib/model/users/profiles";
	import AboutMe from "./AboutMe.svelte";
	import BlockedProfile from "./BlockedProfile.svelte";
	import ProfileBottomNavBar from "./bottom-nav/ProfileBottomNavBar.svelte";
	import Distance from "./Distance.svelte";
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
	import ProfileTags from "./ProfileTags.svelte";
	import SexualPosition from "./SexualPosition.svelte";
	import ProfileTopNavBar from "./top-nav/ProfileTopNavBar.svelte";

	let { data }: import("./$types").PageProps = $props();

	const ourProfileId = $derived(data.ourProfileId);
	const profileId = $derived(Number(page.params.profileId));

	let profileContainer = $state<HTMLElement | null>(null);
	let profile = $state<Profile | null>(null);
	let loading = $state(true);
	let loadError = $state<Error | null>(null);
	let refreshing = $state(false);
	let navigationBusy = $state(false);
	let swipeOffsetX = $state(0);
	let swipeSettling = $state(false);
	let pendingEntryDirection = $state<ProfileNavigationDirection | null>(null);

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
	const swipeOpacity = $derived(
		Math.max(0.45, 1 - Math.min(Math.abs(swipeOffsetX), 240) / 480),
	);

	async function loadProfile(id: number, isRefresh: boolean) {
		if (isRefresh) {
			refreshing = true;
			invalidateProfile(id);
		} else {
			loading = true;
			loadError = null;
			profile = null;
		}
		try {
			const result = await getProfile(id);
			if (id !== profileId) return;
			profile = result;
			loadError = null;
		} catch (error) {
			if (id !== profileId) return;
			loadError = error instanceof Error ? error : new Error(String(error));
			profile = null;
		} finally {
			if (id === profileId) {
				loading = false;
				refreshing = false;
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
		void loadProfile(id, false);
	});

	function refresh() {
		if (refreshing || loading) return;
		void loadProfile(profileId, true);
	}

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
			profileContainer?.scrollTo({ top: 0, behavior: "auto" });

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
		if (!browseNavigation || navigationBusy) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		if (event.clientX <= 24 || isProfileSwipeInteractiveTarget(event.target))
			return;

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
		swipeOffsetX = rubberBandOffset(deltaX);
	}

	function handleProfilePointerUp(event: PointerEvent) {
		if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
		const start = swipeStart;
		swipeStart = null;
		if (start.axis !== "horizontal") return;

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

		if (event.key === "ArrowLeft" && canNavigatePrevious) {
			event.preventDefault();
			void navigateToAdjacent("previous");
		} else if (event.key === "ArrowRight" && canNavigateNext) {
			event.preventDefault();
			void navigateToAdjacent("next");
		}
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
			onRefresh={() => void loadProfile(profileId, false)}
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
			onRetry={() => void loadProfile(profileId, false)}
			class="m-auto"
		/>
	</div>
{:else}
	<div class="relative -mb-(--nav-height) h-screen-safe">
		<div
			class="h-full overflow-y-auto overscroll-contain"
			bind:this={profileContainer}
		>
			<main
				class={[
					"relative mx-auto min-h-overscrollable w-full max-w-200 touch-pan-y will-change-transform",
					{
						"transition-[transform,opacity] duration-[170ms] ease-out motion-reduce:transition-none":
							swipeSettling,
					},
				]}
				style:opacity={swipeOpacity}
				style:transform={`translate3d(${swipeOffsetX}px, 0, 0)`}
			>
				{#if loading || !profile}
					<div class="flex max-w-full flex-col">
						<Skeleton
							class="aspect-3/4 h-auto max-h-photo w-full rounded-none"
						/>

						<div
							class={[
								"flex max-w-full flex-col gap-3.5 p-4",
								{
									"pb-24": ourProfile,
									"pb-40": !ourProfile,
								},
							]}
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
					<ImageCarousel {medias} />
					<ProfileTopNavBar
						{ourProfileId}
						{profile}
						onBlocked={() => {
							optimisticBlockProfileId = profileId;
						}}
					/>
					<div
						class={[
							"flex flex-col p-4",
							{
								"pb-24": ourProfile,
								"pb-40": !ourProfile,
							},
						]}
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
					<ProfileBottomNavBar
						{ourProfileId}
						{profileId}
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
			</main>
		</div>
		<DataRefreshControl
			container={profileContainer}
			updating={refreshing}
			position="top"
			onrefresh={refresh}
		/>
	</div>
{/if}

{#if browseNavigation}
	<button
		type="button"
		aria-label="Previous profile"
		disabled={!canNavigatePrevious || navigationBusy}
		class="fixed top-1/2 left-2 z-40 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-background/45 text-foreground shadow-lg backdrop-blur-md transition-opacity disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
		data-profile-swipe-ignore
		onclick={() => void navigateToAdjacent("previous")}
	>
		<CaretLeftIcon aria-hidden="true" class="size-6" />
	</button>
	<button
		type="button"
		aria-label="Next profile"
		disabled={!canNavigateNext || navigationBusy}
		class="fixed top-1/2 right-2 z-40 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-background/45 text-foreground shadow-lg backdrop-blur-md transition-opacity disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
		data-profile-swipe-ignore
		onclick={() => void navigateToAdjacent("next")}
	>
		<CaretRightIcon aria-hidden="true" class="size-6" />
	</button>
	<p class="sr-only" aria-live="polite">
		{#if navigationBusy}Loading adjacent profile{/if}
	</p>
{/if}
