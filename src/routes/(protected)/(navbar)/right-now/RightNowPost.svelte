<script lang="ts">
	import { env } from "$env/dynamic/public";
	import {
		ChatIcon,
		ClockIcon,
		HouseIcon,
		NavigationArrowIcon,
	} from "phosphor-svelte";

	import DistanceFormatted from "$lib/components/profile/DistanceFormatted.svelte";
	import ProfileFacts from "$lib/components/profile/ProfileFacts.svelte";
	import RelativeTimeDynamic from "$lib/components/shared/RelativeTimeDynamic.svelte";
	import { Button } from "$lib/components/ui/button";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
	import type { ProfileSummary } from "$lib/api/users/profiles";
	import type { FeedPost } from "$lib/right-now/posts";
	import RightNowAvatar from "./RightNowAvatar.svelte";

	let {
		post,
		ourProfileId,
		summary,
		onOpenMedia,
	}: {
		post: FeedPost;
		ourProfileId: number;
		summary: ProfileSummary | null;
		onOpenMedia: (mediaKey: string, opener: HTMLAnchorElement) => void;
	} = $props();

	const conversationId = $derived(
		[post.profileId, ourProfileId].toSorted((a, b) => a - b).join(":"),
	);
</script>

<article
	class="flex w-full gap-2 rounded-2xl border bg-card p-2 text-muted-foreground md:gap-3 md:p-3"
	aria-label="Right Now post by {post.displayName ?? 'someone'}"
>
	<RightNowAvatar
		profileId={post.profileId}
		displayName={post.displayName}
		mediaHash={post.mediaHash}
		onlineUntil={post.onlineUntil}
	/>
	<div class="min-w-0 flex-1">
		<p
			class={[
				"wrap-break-word",
				post.text ? "text-foreground" : "font-semibold",
			]}
		>
			{post.text ??
				(post.displayName ? `${post.displayName} joined` : "Joined")}
		</p>
		<ProfileFacts
			profileId={post.profileId}
			{summary}
			class="mt-1 hidden md:flex"
		/>
		{#if post.media.length > 0}
			<div class="mt-2 grid gap-1">
				{#each post.media as image (image.mediaId)}
					<a
						href={image.fullImageUrl}
						rel="noreferrer"
						aria-label="Open image from {post.displayName ?? 'this post'}"
						class="pswp-trigger block overflow-hidden rounded-xl bg-muted"
						onclick={(event) => {
							event.preventDefault();
							onOpenMedia(`${post.id}:${image.mediaId}`, event.currentTarget);
						}}
					>
						<img
							src={image.thumbnailUrl}
							alt=""
							class={[
								"max-h-80 w-full object-cover",
								{
									"blur-2xl":
										image.shouldBlur && env.PUBLIC_ENABLE_BLUR_EFFECTS,
								},
							]}
							loading="lazy"
							draggable="false"
						/>
					</a>
				{/each}
			</div>
		{/if}
		<div class="mt-2 flex items-center justify-between gap-2 text-sm">
			<div class="flex min-w-0 flex-wrap items-center gap-1.5">
				<ClockIcon class="size-4" aria-hidden="true" />
				<span class="sr-only">Posted:</span>
				<RelativeTimeDynamic date={post.posted} />
				{#if post.distance !== null}
					<NavigationArrowIcon class="size-4 -scale-x-100" aria-hidden="true" />
					<span class="sr-only">Distance:</span>
					<DistanceFormatted distance={post.distance} />
				{/if}
				{#if post.hosting}
					<HouseIcon
						class="size-4 text-fuchsia-500"
						weight="fill"
						aria-hidden="true"
					/>
					<span class="sr-only">Hosting</span>
				{/if}
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				href="/chat/{conversationId}"
				onclick={(event) =>
					interceptAppNavigationClick(event, () =>
						openAppDetail(`/chat/${conversationId}`),
					)}
				aria-label="Message {post.displayName ?? 'this profile'}"
			>
				<ChatIcon aria-hidden="true" />
			</Button>
		</div>
	</div>
</article>
