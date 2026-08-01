<script lang="ts">
	import GeoMapPicker from "$lib/components/location-chooser/GeoMapPicker.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import * as Dialog from "$lib/components/ui/dialog";
	import * as Drawer from "$lib/components/ui/drawer/index";
	import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
	import { above } from "$lib/util/breakpoints.svelte";
	import type { LocationPoint } from "$lib/model/location";

	let {
		onBrowse,
		onSetProfile,
		onUseDeviceLocation,
		open = $bindable(),
		pinPos = $bindable(),
	}: {
		onBrowse: (point: LocationPoint) => void | Promise<void>;
		onSetProfile: (point: LocationPoint) => void | Promise<void>;
		onUseDeviceLocation?: () => void | Promise<void>;
		open: boolean;
		pinPos?:
			| {
					lat: number;
					lon: number;
					zoom: number;
			  }
			| undefined;
	} = $props();

	const isDesktop = above("md");
	let submitting: "browse" | "profile" | "device" | null = $state(null);

	async function submitPin(action: "browse" | "profile") {
		if (!pinPos) return;
		submitting = action;
		try {
			const point = { lat: pinPos.lat, lon: pinPos.lon };
			await (action === "browse" ? onBrowse(point) : onSetProfile(point));
			open = false;
		} catch (error) {
			console.error("Location selection failed", error);
		} finally {
			submitting = null;
		}
	}

	async function useDeviceLocation() {
		if (!onUseDeviceLocation) return;
		submitting = "device";
		try {
			await onUseDeviceLocation();
			open = false;
		} catch (error) {
			console.error("Device location selection failed", error);
		} finally {
			submitting = null;
		}
	}

	let geoMapPicker: GeoMapPicker | null = $state(null);

	let pendingCenter: { lat: number; lon: number; zoom: number } | null =
		$state(null);
	export function centerAt({
		lat,
		lon,
		zoom,
	}: {
		lat: number;
		lon: number;
		zoom: number;
	}) {
		if (!geoMapPicker) {
			pendingCenter = { lat, lon, zoom };
		} else {
			geoMapPicker.centerAt({ lat, lon, zoom });
		}
	}

	$effect(() => {
		if (pendingCenter && geoMapPicker) {
			geoMapPicker.centerAt(pendingCenter);
			pendingCenter = null;
		}
	});

	$effect(() => {
		if (open) {
			const onBackGesture = () => {
				open = false;
				return false;
			};
			backGestureEventHandlers.add(onBackGesture);
			return () => {
				backGestureEventHandlers.delete(onBackGesture);
			};
		}
	});
</script>

{#if isDesktop.current}
	<Dialog.Root bind:open>
		<Dialog.Content
			class="flex h-[calc(var(--screen-safe)-4rem)] flex-col sm:max-w-200"
			showCloseButton={false}
		>
			<div
				class="h-full flex-1 touch-manipulation overflow-clip rounded-lg"
				data-vaul-no-drag
			>
				<GeoMapPicker bind:pinPos bind:this={geoMapPicker} />
			</div>
			<Dialog.Footer>
				<Button
					variant="secondary"
					disabled={!pinPos || submitting !== null}
					onclick={() => void submitPin("browse")}
				>
					Browse this area
				</Button>
				<Button
					disabled={!pinPos || submitting !== null}
					onclick={() => void submitPin("profile")}
				>
					Set profile location
				</Button>
				{#if onUseDeviceLocation}
					<Button
						variant="outline"
						disabled={submitting !== null}
						onclick={() => void useDeviceLocation()}
					>
						Use current device location
					</Button>
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<Drawer.Root bind:open>
		<Drawer.Content
			preventOverflowTextSelection={false}
			class="mt-0! mb-(--safe-area-bottom) h-full!"
		>
			<div
				class="mt-4 mb-2 h-full touch-manipulation overflow-clip rounded-lg"
				data-vaul-no-drag
			>
				<GeoMapPicker bind:pinPos bind:this={geoMapPicker} />
			</div>
			<Drawer.Footer class="pt-2 pb-(--safe-area-bottom)">
				<Button
					variant="secondary"
					disabled={!pinPos || submitting !== null}
					onclick={() => void submitPin("browse")}
				>
					Browse this area
				</Button>
				<Button
					disabled={!pinPos || submitting !== null}
					onclick={() => void submitPin("profile")}
				>
					Set profile location
				</Button>
				{#if onUseDeviceLocation}
					<Button
						variant="outline"
						disabled={submitting !== null}
						onclick={() => void useDeviceLocation()}
					>
						Use current device location
					</Button>
				{/if}
			</Drawer.Footer>
		</Drawer.Content>
	</Drawer.Root>
{/if}
