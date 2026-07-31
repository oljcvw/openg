import z from "zod";

import { callMethod } from "$lib/api";
import { clearLocalAccountState } from "$lib/api/sign-out";

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
	await callMethod("delete_account");
	await clearLocalAccountState();
}
