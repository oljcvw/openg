import z from "zod";

import { callMethod } from "$lib/api";
import { clearLocalAccountState } from "$lib/api/sign-out";
import { deleteFavoriteNotesForAccount } from "$lib/app-data/favorite-notes";
import { deleteSavedPhrasesForAccount } from "$lib/app-data/saved-phrases";

export class AccountDeletionCleanupError extends Error {
	constructor(options: ErrorOptions) {
		super("Account deleted, but local account data cleanup failed.", options);
		this.name = "AccountDeletionCleanupError";
	}
}

export const emailSchema = z.email("Enter a valid email address");
export const passwordSchema = z
	.string()
	.min(8, "Use at least 8 characters")
	.max(1024, "Password is too long");

export async function validatePasswordComplexity(
	password: string,
): Promise<void> {
	await callMethod("validate_password_complexity", { password });
}

export async function changePassword(input: {
	currentPassword: string;
	newPassword: string;
}): Promise<void> {
	await callMethod("update_account_password", input);
	await clearLocalAccountState();
}

export async function changeEmail(input: {
	email: string;
	password: string;
}): Promise<void> {
	await callMethod("update_account_email", input);
	await clearLocalAccountState();
}

export async function deleteAccount(): Promise<void> {
	const accountProfileId = await callMethod("auth_state");
	if (accountProfileId === null) {
		throw new Error("Cannot delete a signed-out account.");
	}
	await callMethod("delete_account");
	try {
		await Promise.all([
			deleteFavoriteNotesForAccount(accountProfileId),
			deleteSavedPhrasesForAccount(accountProfileId),
			callMethod("notification_clear_account", {
				accountId: accountProfileId,
			}),
		]);
	} catch (error) {
		throw new AccountDeletionCleanupError({ cause: error });
	} finally {
		await clearLocalAccountState();
	}
}
