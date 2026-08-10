<script lang="ts">
	import DisplayName from "$lib/components/profile/DisplayName.svelte";
	import ProfileStatusIndicator from "$lib/components/profile/ProfileStatusIndicator.svelte";
	import UserAvatar from "$lib/components/profile/UserAvatar.svelte";
	import * as Avatar from "$lib/components/ui/avatar";
	import * as Item from "$lib/components/ui/item";
	import {
		interceptAppNavigationClick,
		openAppDetail,
	} from "$lib/navigation/app-navigation";
	import { longPressHandlers } from "$lib/util/long-press";

	let {
		avatar,
		title,
		onlineUntil = null,
		active,
		ariaCurrent,
		selected,
		link,
		description,
		actions,
		actionsPlacement = "side",
		compact = false,
		class: className,
		titleClass,
		onToggleSelected,
		onLongPress,
		onNavigate,
		density = "comfortable",
	}: {
		avatar: {
			mediaHash: string | null;
			overlay?: import("svelte").Snippet;
			link?: string;
		};
		title: {
			value: string | null;
			badge?: import("svelte").Snippet;
		};
		onlineUntil?: number | null;
		active?: boolean;
		ariaCurrent?: "page";
		selected?: boolean;
		link: string;
		description?: import("svelte").Snippet;
		actions?: import("svelte").Snippet;
		actionsPlacement?: "side" | "title";
		compact?: boolean;
		class?: import("svelte/elements").ClassValue;
		titleClass?: import("svelte/elements").ClassValue;
		onToggleSelected?: () => void;
		onLongPress?: () => void;
		onNavigate?: (route: string) => void | Promise<unknown>;
		density?: "compact" | "comfortable" | "roomy";
	} = $props();

	const longPress = $derived(onLongPress ? longPressHandlers(onLongPress) : {});
	const linkTabindex = $derived(onToggleSelected ? -1 : undefined);
	const navigateRow = $derived(onNavigate ?? openAppDetail);
	const minimumBlockSize = $derived(
		density === "compact" ? "5rem" : density === "roomy" ? "8rem" : "6.5rem",
	);
	const avatarSize = $derived(
		density === "compact"
			? "size-14"
			: density === "roomy"
				? "size-24"
				: "size-20",
	);
</script>

{#snippet avatarNode()}
	<Item.Media
		class={["relative translate-y-0! rounded-2xl", compact ? "p-1.5" : "p-2"]}
	>
		<Avatar.Root class={[avatarSize, "after:rounded-xl"]}>
			<UserAvatar
				mediaHash={avatar.mediaHash}
				class={[avatarSize, "rounded-xl bg-neutral-700 *:rounded-xl"]}
			/>
		</Avatar.Root>
		{@render avatar.overlay?.()}
	</Item.Media>
{/snippet}
{#snippet titleNode(className = "")}
	<Item.Title
		class={[
			"flex w-auto min-w-0 items-center gap-1 truncate",
			className,
			titleClass,
			{
				"text-muted-foreground": !title.value,
			},
		]}
	>
		{@render title.badge?.()}
		<ProfileStatusIndicator {onlineUntil} />
		<DisplayName name={title.value} class="truncate" />
	</Item.Title>
{/snippet}
{#snippet contentNode()}
	{#if actionsPlacement === "title"}
		<Item.Content class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				{@render titleNode("flex-1")}
				{@render actions?.()}
			</div>
			{@render description?.()}
		</Item.Content>
	{:else}
		<Item.Content class="min-w-0 flex-1">
			{@render titleNode()}
			{@render description?.()}
		</Item.Content>
		{@render actions?.()}
	{/if}
{/snippet}
<Item.Root
	variant={active ? "muted" : "outline"}
	data-density={density}
	style={`min-block-size: ${minimumBlockSize}`}
	class={[
		"@container relative flex min-w-24 flex-nowrap items-stretch gap-0 p-0",
		{
			"border-primary outline-2 -outline-offset-2 outline-primary outline-solid":
				selected,
			"[-webkit-touch-callout:none] **:[-webkit-touch-callout:none]":
				!!onLongPress,
		},
		className,
	]}
	{...longPress}
>
	{#if avatar.link}
		<a
			href={avatar.link}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => openAppDetail(avatar.link!))}
			class="rounded-l-2xl outline-none focus-visible:z-3 focus-visible:ring-[3px] focus-visible:ring-primary/70 @max-row:hidden"
			tabindex={linkTabindex}
		>
			{@render avatarNode()}
		</a>
		<a
			href={link}
			aria-current={ariaCurrent}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => navigateRow(link))}
			class={[
				"content gap-0.5 rounded-r-2xl outline-none focus-visible:z-3 focus-visible:ring-[3px] focus-visible:ring-primary/70 @max-row:hidden!",
				compact ? "py-3 ps-1 pe-3" : "p-4 ps-2",
			]}
			tabindex={linkTabindex}
		>
			{@render contentNode()}
		</a>
		<a
			href={link}
			aria-current={ariaCurrent}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => navigateRow(link))}
			class="min-w-24 rounded-2xl outline-none focus-visible:z-3 focus-visible:ring-[3px] focus-visible:ring-primary/70 @row:hidden"
			tabindex={linkTabindex}
		>
			{@render avatarNode()}
		</a>
	{:else}
		<a
			href={link}
			aria-current={ariaCurrent}
			onclick={(event) =>
				interceptAppNavigationClick(event, () => navigateRow(link))}
			class="content gap-2.5 overflow-clip rounded-2xl pe-4 outline-none focus-visible:z-3 focus-visible:ring-[3px] focus-visible:ring-primary/70"
			tabindex={linkTabindex}
		>
			{@render avatarNode()}
			{@render contentNode()}
		</a>
	{/if}
	{#if selected}
		<div
			class="pointer-events-none absolute -inset-px z-1 rounded-[inherit] bg-primary/20"
		></div>
	{/if}
	{#if onToggleSelected}
		<button
			type="button"
			class="absolute inset-0 z-2 rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-pressed={selected ?? false}
			aria-label={title.value ?? "Someone"}
			onclick={onToggleSelected}
		></button>
	{/if}
</Item.Root>

<style lang="postcss">
	@reference "$layout";

	.content {
		@apply flex min-w-0 flex-1 items-center self-stretch;
	}
</style>
