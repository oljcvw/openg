<script lang="ts">
	import CacheSetting from "./CacheSetting.svelte";
	import ContrastSetting from "./ContrastSetting.svelte";
	import GridColumnsSetting from "./GridColumnsSetting.svelte";
	import InboxAppearanceSetting from "./InboxAppearanceSetting.svelte";
	import KeepUnavailableCachedAlbumsSetting from "./KeepUnavailableCachedAlbumsSetting.svelte";
	import KeyboardNavigationSetting from "./KeyboardNavigationSetting.svelte";
	import NotificationsLink from "./NotificationsLink.svelte";
	import ProfileSwipeNavigationSetting from "./ProfileSwipeNavigationSetting.svelte";
	import RetainSharedChatMediaSetting from "./RetainSharedChatMediaSetting.svelte";
	import RevealMessageReadSetting from "./RevealMessageReadSetting.svelte";
	import RevealProfileViewSetting from "./RevealProfileViewSetting.svelte";
	import ShowRetractedMessagesSetting from "./ShowRetractedMessagesSetting.svelte";
	import StayAwakeSetting from "./StayAwakeSetting.svelte";
	import UnitsSetting from "./UnitsSetting.svelte";
</script>

<h2>Display</h2>
<UnitsSetting />
<ContrastSetting />
<GridColumnsSetting />
<InboxAppearanceSetting />
<StayAwakeSetting />
<h2>Storage</h2>
<CacheSetting />
<KeepUnavailableCachedAlbumsSetting />
<RetainSharedChatMediaSetting />
<h2>Accessibility</h2>
<ProfileSwipeNavigationSetting />
<h2>Messages</h2>
<ShowRetractedMessagesSetting />
<KeyboardNavigationSetting />
<h2>Notifications</h2>
<NotificationsLink />
<h2>Privacy</h2>
<RevealMessageReadSetting />
<RevealProfileViewSetting />

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply mt-2 truncate ps-4 text-xl font-semibold tracking-tight;
	}
</style>
