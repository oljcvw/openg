<script lang="ts">
	import { goto } from "$app/navigation";
	import { toast } from "svelte-sonner";

	import { changeEmail, emailSchema } from "$lib/api/account-mutations";
	import { showErrorToast } from "$lib/api/error";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Spinner } from "$lib/components/ui/spinner";

	let email = $state("");
	let password = $state("");
	let submitting = $state(false);
	let validationMessage = $state("");

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const parsed = emailSchema.safeParse(email.trim());
		if (!parsed.success) {
			validationMessage = parsed.error.issues[0]?.message ?? "Invalid email";
			return;
		}
		if (!password) {
			validationMessage = "Enter your current password";
			return;
		}
		submitting = true;
		validationMessage = "";
		try {
			const outcome = await changeEmail({ email: parsed.data, password });
			password = "";
			toast.success("Email changed", {
				description: outcome.localCleanupComplete
					? "Sign in again with your new email."
					: "The email changed, but some local data could not be cleared. Clear app data before signing in again.",
			});
			await goto("/auth/sign-in");
		} catch (error) {
			password = "";
			showErrorToast({ label: "Failed to change email", error });
		} finally {
			submitting = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Change email</Card.Title>
		<Card.Description>
			Confirm the change with your current password. You will be signed out
			afterwards.
		</Card.Description>
	</Card.Header>
	<form onsubmit={submit}>
		<Card.Content class="grid gap-4">
			<div class="grid gap-2">
				<Label for="new-email">New email</Label>
				<Input
					id="new-email"
					type="email"
					autocomplete="email"
					required
					disabled={submitting}
					bind:value={email}
				/>
			</div>
			<div class="grid gap-2">
				<Label for="email-password">Current password</Label>
				<Input
					id="email-password"
					type="password"
					autocomplete="current-password"
					required
					disabled={submitting}
					bind:value={password}
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
				Change email
			</Button>
		</Card.Footer>
	</form>
</Card.Root>
