<script lang="ts">
	import GridColumnsSetting from "./GridColumnsSetting.svelte";
	import NotificationsLink from "./NotificationsLink.svelte";
	import RevealMessageReadSetting from "./RevealMessageReadSetting.svelte";
	import RevealProfileViewSetting from "./RevealProfileViewSetting.svelte";
	import StayAwakeSetting from "./StayAwakeSetting.svelte";
	import UnitsSetting from "./UnitsSetting.svelte";
</script>

<h2>Display</h2>
<UnitsSetting />
<GridColumnsSetting />
<StayAwakeSetting />
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
