<script lang="ts">
	import { goto } from "$app/navigation";
	import { toast } from "svelte-sonner";

	import {
		changePassword,
		passwordSchema,
		validatePasswordComplexity,
	} from "$lib/api/account-mutations";
	import { showErrorToast } from "$lib/api/error";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Spinner } from "$lib/components/ui/spinner";

	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmation = $state("");
	let submitting = $state(false);
	let validationMessage = $state("");

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const parsed = passwordSchema.safeParse(newPassword);
		if (!parsed.success) {
			validationMessage =
				parsed.error.issues[0]?.message ?? "Choose a stronger password";
			return;
		}
		if (!currentPassword) {
			validationMessage = "Enter your current password";
			return;
		}
		if (newPassword !== confirmation) {
			validationMessage = "The new passwords do not match";
			return;
		}
		if (newPassword === currentPassword) {
			validationMessage = "Choose a password you are not already using";
			return;
		}
		submitting = true;
		validationMessage = "";
		try {
			await validatePasswordComplexity(newPassword);
			const outcome = await changePassword({ currentPassword, newPassword });
			currentPassword = "";
			newPassword = "";
			confirmation = "";
			toast.success("Password changed", {
				description: outcome.localCleanupComplete
					? "Sign in again with your new password."
					: "The password changed, but some local data could not be cleared. Clear app data before signing in again.",
			});
			await goto("/auth/sign-in");
		} catch (error) {
			currentPassword = "";
			newPassword = "";
			confirmation = "";
			showErrorToast({ label: "Failed to change password", error });
		} finally {
			submitting = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Change password</Card.Title>
		<Card.Description>
			Your session and device credentials will be rotated after the change.
		</Card.Description>
	</Card.Header>
	<form onsubmit={submit}>
		<Card.Content class="grid gap-4">
			<div class="grid gap-2">
				<Label for="current-password">Current password</Label>
				<Input
					id="current-password"
					type="password"
					autocomplete="current-password"
					required
					disabled={submitting}
					bind:value={currentPassword}
				/>
			</div>
			<div class="grid gap-2">
				<Label for="new-password">New password</Label>
				<Input
					id="new-password"
					type="password"
					autocomplete="new-password"
					minlength={8}
					required
					disabled={submitting}
					bind:value={newPassword}
				/>
			</div>
			<div class="grid gap-2">
				<Label for="confirm-password">Confirm new password</Label>
				<Input
					id="confirm-password"
					type="password"
					autocomplete="new-password"
					minlength={8}
					required
					disabled={submitting}
					bind:value={confirmation}
				/>
			</div>
			{#if validationMessage}
				<p class="text-sm text-destructive" role="alert">
					{validationMessage}
				</p>
			{/if}
		</Card.Content>
		<Card.Footer class="pt-6">
			<Button class="w-full" type="submit" disabled={submitting}>
				{#if submitting}<Spinner />{/if}
				Change password
			</Button>
		</Card.Footer>
	</form>
</Card.Root>
