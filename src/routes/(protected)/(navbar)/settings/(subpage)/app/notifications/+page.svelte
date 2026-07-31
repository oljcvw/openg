<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { callMethod, type NotificationSettings } from "$lib/api";
	import { showErrorToast } from "$lib/api/error";
	import * as Alert from "$lib/components/ui/alert";
	import { Button } from "$lib/components/ui/button";
	import * as Item from "$lib/components/ui/item";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	let settings = $state<NotificationSettings | null>(null);
	let saving = $state(false);
	let testing = $state(false);

	onMount(() => {
		void load();
	});

	async function load() {
		try {
			settings = await callMethod("notification_get_settings");
		} catch (error) {
			showErrorToast({ label: "Failed to load notification settings", error });
		}
	}

	async function save(next: Partial<NotificationSettings>) {
		if (!settings || saving) return;
		const previous = settings;
		const requested = { ...settings, ...next };
		settings = requested;
		saving = true;
		try {
			settings = await callMethod("notification_set_settings", {
				enabled: requested.enabled,
				messages: requested.messages,
				taps: requested.taps,
				showPreviews: requested.showPreviews,
			});
			if (next.enabled && !settings.enabled) {
				toast.error(
					"Notification permission was not granted. You can enable it in Android system settings.",
				);
			}
		} catch (error) {
			settings = previous;
			showErrorToast({ label: "Failed to save notification settings", error });
		} finally {
			saving = false;
		}
	}

	async function sendTest() {
		testing = true;
		try {
			await callMethod("notification_test");
			toast.success("Test notification sent");
		} catch (error) {
			showErrorToast({ label: "Failed to send test notification", error });
		} finally {
			testing = false;
		}
	}

	function formatCheck(timestamp: number | null): string {
		if (timestamp === null) return "Not checked yet";
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(timestamp);
	}
</script>

{#if settings === null}
	<Item.Root variant="outline">
		<Item.Content>
			<Item.Title>Loading notification settings…</Item.Title>
		</Item.Content>
	</Item.Root>
{:else if !settings.supported}
	<Alert.Root>
		<Alert.Title>Android only</Alert.Title>
		<Alert.Description>
			Background message and tap notifications are currently available on
			Android.
		</Alert.Description>
	</Alert.Root>
{:else}
	<Alert.Root>
		<Alert.Title>Periodic, not real-time</Alert.Title>
		<Alert.Description>
			Android checks about every 15 minutes while network access is available.
			Battery optimization may delay a check.
		</Alert.Description>
	</Alert.Root>

	<SwitchField
		title="Background notifications"
		description="Check for new messages and taps while Open Grind is closed."
		disabled={saving}
		bind:checked={
			() => settings!.enabled, (enabled: boolean) => void save({ enabled })
		}
	/>

	<h2>Notify me about</h2>
	<SwitchField
		title="Messages"
		description="Show an alert when an unread conversation changes."
		disabled={saving || !settings.enabled}
		bind:checked={
			() => settings!.messages, (messages: boolean) => void save({ messages })
		}
	/>
	<SwitchField
		title="Taps"
		description="Show an alert when someone new taps you."
		disabled={saving || !settings.enabled}
		bind:checked={() => settings!.taps, (taps: boolean) => void save({ taps })}
	/>

	<h2>Privacy</h2>
	<SwitchField
		title="Show notification previews"
		description="Include profile names and message text on the lock screen. Off by default."
		disabled={saving || !settings.enabled}
		bind:checked={
			() => settings!.showPreviews,
			(showPreviews: boolean) => void save({ showPreviews })
		}
	/>

	<Item.Root variant="outline">
		<Item.Content>
			<Item.Title>Background check status</Item.Title>
			<Item.Description>
				Last successful check: {formatCheck(settings.lastSuccessfulCheck)}
				{#if settings.lastError}
					<br />{settings.lastError}
				{/if}
			</Item.Description>
		</Item.Content>
	</Item.Root>

	<Button
		variant="outline"
		disabled={!settings.enabled || settings.permission !== "granted" || testing}
		onclick={() => void sendTest()}
	>
		{testing ? "Sending…" : "Send test notification"}
	</Button>
{/if}

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply mt-2 truncate ps-4 text-xl font-semibold tracking-tight;
	}
</style>
