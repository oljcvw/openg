<script lang="ts">
	import { goto } from "$app/navigation";

	import { deleteAccount } from "$lib/api/account-mutations";
	import { showErrorToast } from "$lib/api/error";
	import * as Alert from "$lib/components/ui/alert";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Spinner } from "$lib/components/ui/spinner";

	const confirmationText = "DELETE";
	let confirmation = $state("");
	let submitting = $state(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (confirmation !== confirmationText) return;
		submitting = true;
		try {
			await deleteAccount();
			await goto("/auth/sign-in");
		} catch (error) {
			showErrorToast({ label: "Failed to delete account", error });
		} finally {
			submitting = false;
		}
	}
</script>

<Alert.Root variant="destructive">
	<Alert.Title>This cannot be undone</Alert.Title>
	<Alert.Description>
		Deleting your account permanently removes the profile through the account
		service and signs this device out.
	</Alert.Description>
</Alert.Root>

<Card.Root>
	<Card.Header>
		<Card.Title>Delete account</Card.Title>
		<Card.Description>
			Type <strong>{confirmationText}</strong> exactly to enable deletion.
		</Card.Description>
	</Card.Header>
	<form onsubmit={submit}>
		<Card.Content class="grid gap-2">
			<Label for="delete-confirmation">Confirmation</Label>
			<Input
				id="delete-confirmation"
				autocomplete="off"
				required
				disabled={submitting}
				bind:value={confirmation}
			/>
		</Card.Content>
		<Card.Footer class="pt-6">
			<Button
				class="w-full"
				variant="destructive"
				type="submit"
				disabled={submitting || confirmation !== confirmationText}
			>
				{#if submitting}<Spinner />{/if}
				Permanently delete account
			</Button>
		</Card.Footer>
	</form>
</Card.Root>
