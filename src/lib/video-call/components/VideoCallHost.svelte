<script lang="ts">
	import { onMount } from "svelte";

	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import {
		videoCallController,
		type VideoCallSnapshot,
	} from "$lib/video-call/controller";

	let snapshot: VideoCallSnapshot = $state(videoCallController.snapshot);

	onMount(() => {
		videoCallController.start();
		const unsubscribe = videoCallController.subscribe((next) => {
			snapshot = next;
		});
		return () => {
			unsubscribe();
			void videoCallController.destroy();
		};
	});

	const peerName = $derived(
		snapshot.peerLabel ??
			(snapshot.peerProfileId === null
				? "Unknown profile"
				: `Profile ${snapshot.peerProfileId}`),
	);
	const active = $derived(
		["starting", "connecting", "connected", "ending"].includes(snapshot.phase),
	);
	const statusTitle = $derived.by(() => {
		if (snapshot.phase === "starting") return "Starting video call";
		if (snapshot.phase === "connecting") return "Waiting for connection";
		if (snapshot.phase === "connected") return "Video call connected";
		return "Ending video call";
	});
</script>

<AlertDialog.Root open={snapshot.phase === "incoming"}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Incoming video call</AlertDialog.Title>
			<AlertDialog.Description>
				{peerName} wants to start a video call. Connected calls end after at most
				60 seconds.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				variant="destructive"
				onclick={() => void videoCallController.declineIncoming()}
			>
				Decline
			</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => void videoCallController.acceptIncoming()}
			>
				Accept
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root open={active}>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>{statusTitle}</Dialog.Title>
			<Dialog.Description>
				{peerName}
				{#if snapshot.phase === "connected" && snapshot.remainingSeconds !== null}
					· {snapshot.remainingSeconds}s remaining
				{:else if snapshot.phase === "connecting"}
					· timer starts when both people connect
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="destructive"
				disabled={snapshot.phase === "starting" || snapshot.phase === "ending"}
				onclick={() => void videoCallController.end()}
			>
				End call
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={snapshot.phase === "error" || snapshot.phase === "unavailable"}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{snapshot.phase === "unavailable"
					? "Video calls unavailable"
					: "Video call failed"}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{snapshot.errorMessage ?? "Video call could not be completed."}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Action onclick={() => videoCallController.dismiss()}>
				OK
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
