<script lang="ts">
	import { showErrorToast } from "$lib/api/error";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import {
		cancelProfileLocationWifiWarning,
		closeProfileLocationWifiWarning,
		continueAfterAndroidWifiDisabled,
		currentWifiWarningState,
		markWifiSettingsOpened,
		profileLocationWifiWarning,
		setWifiWarningBusy,
	} from "$lib/location/profile-location-wifi-warning";
	import {
		isAndroidWifiEnabled,
		openAndroidWifiSettings,
		restartAndroidApp,
	} from "$lib/platform/android-native-bridge";

	function openWifiControls(): void {
		openAndroidWifiSettings();
		markWifiSettingsOpened();
	}

	async function continueAndroid(): Promise<void> {
		const state = currentWifiWarningState();
		if (!state.settingsOpened || isAndroidWifiEnabled()) {
			openWifiControls();
			return;
		}
		setWifiWarningBusy(true);
		try {
			const outcome = await continueAfterAndroidWifiDisabled(state.intent);
			if (outcome.kind === "applied") {
				closeProfileLocationWifiWarning();
				return;
			}
			if (outcome.kind === "stagedForRestart") {
				restartAndroidApp();
				return;
			}
			if (outcome.kind === "blockedByWifi") {
				openWifiControls();
				return;
			}
		} catch (error) {
			console.error(error);
			showErrorToast({
				label: "Failed to resume after Wi-Fi disconnect",
				error,
			});
		} finally {
			setWifiWarningBusy(false);
		}
	}
</script>

<AlertDialog.Root
	open={$profileLocationWifiWarning.open}
	onOpenChange={(open) => {
		if (!open) cancelProfileLocationWifiWarning();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Turn off Wi-Fi for location safety</AlertDialog.Title>
			<AlertDialog.Description>
				Using Wi-Fi while mocking your profile location is likely to lead to an
				account ban. Grindr traffic is paused and no new location change has
				been applied.
				{#if $profileLocationWifiWarning.platform === "android"}
					Open Android's Wi-Fi controls and turn the Wi-Fi adapter off.
					{#if $profileLocationWifiWarning.intent !== null}
						When you return, Open Grind will stage the requested state and
						restart.
					{/if}
				{:else}
					Turn Wi-Fi off in iOS Settings before trying again. Open Grind cannot
					disable Wi-Fi or restart itself on iOS.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				disabled={$profileLocationWifiWarning.busy}
				onclick={cancelProfileLocationWifiWarning}
			>
				Cancel
			</AlertDialog.Cancel>
			{#if $profileLocationWifiWarning.platform === "android"}
				<Button
					disabled={$profileLocationWifiWarning.busy}
					onclick={() => void continueAndroid()}
				>
					{$profileLocationWifiWarning.settingsOpened
						? "Verify Wi-Fi is off and continue"
						: "Continue and turn off Wi-Fi"}
				</Button>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
