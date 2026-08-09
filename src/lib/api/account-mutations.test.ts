import { beforeEach, describe, expect, it, vi } from "vitest";

import { callMethod } from "$lib/api";
import {
	changeEmail,
	changePassword,
	deleteAccount,
} from "$lib/api/account-mutations";
import { clearLocalAccountState } from "$lib/api/sign-out";
import { deleteFavoriteNotesForAccount } from "$lib/app-data/favorite-notes";
import { deleteSavedPhrasesForAccount } from "$lib/app-data/saved-phrases";

vi.mock("$lib/api", () => ({
	callMethod: vi.fn(),
}));
vi.mock("$lib/api/sign-out", () => ({
	clearLocalAccountState: vi.fn(),
}));
vi.mock("$lib/app-data/favorite-notes", () => ({
	deleteFavoriteNotesForAccount: vi.fn(),
}));
vi.mock("$lib/app-data/saved-phrases", () => ({
	deleteSavedPhrasesForAccount: vi.fn(),
}));

const callMethodMock = vi.mocked(callMethod);
const clearLocalAccountStateMock = vi.mocked(clearLocalAccountState);
const deleteFavoriteNotesForAccountMock = vi.mocked(
	deleteFavoriteNotesForAccount,
);
const deleteSavedPhrasesForAccountMock = vi.mocked(
	deleteSavedPhrasesForAccount,
);

describe("account mutation local cleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		callMethodMock.mockImplementation((method) => {
			if (method === "auth_state") return Promise.resolve(100);
			if (
				method === "update_account_email" ||
				method === "update_account_password" ||
				method === "delete_account"
			)
				return Promise.resolve({
					remoteApplied: true,
					localCleanupComplete: true,
				});
			return Promise.resolve(undefined);
		});
		clearLocalAccountStateMock.mockResolvedValue(true);
	});

	it("deletes only the current account's private local data after account deletion", async () => {
		await deleteAccount();

		expect(callMethodMock).toHaveBeenNthCalledWith(1, "auth_state");
		expect(callMethodMock).toHaveBeenNthCalledWith(2, "delete_account");
		expect(deleteFavoriteNotesForAccountMock).toHaveBeenCalledWith(100);
		expect(deleteSavedPhrasesForAccountMock).toHaveBeenCalledWith(100);
		expect(callMethodMock).toHaveBeenNthCalledWith(
			3,
			"notification_clear_account",
			{ accountId: 100 },
		);
		expect(clearLocalAccountStateMock).toHaveBeenCalledOnce();
	});

	it("preserves private notes during email and password changes", async () => {
		await changeEmail({
			email: "new@example.com",
			password: "current-password",
		});
		await changePassword({
			currentPassword: "current-password",
			newPassword: "different-password",
		});

		expect(deleteFavoriteNotesForAccountMock).not.toHaveBeenCalled();
		expect(deleteSavedPhrasesForAccountMock).not.toHaveBeenCalled();
		expect(callMethodMock).not.toHaveBeenCalledWith(
			"notification_clear_account",
			expect.anything(),
		);
		expect(clearLocalAccountStateMock).toHaveBeenCalledTimes(2);
	});

	it("preserves remote success while reporting incomplete native cleanup", async () => {
		callMethodMock.mockResolvedValueOnce({
			remoteApplied: true,
			localCleanupComplete: false,
		});

		await expect(
			changePassword({
				currentPassword: "current-password",
				newPassword: "different-password",
			}),
		).resolves.toEqual({
			remoteApplied: true,
			localCleanupComplete: false,
		});
	});

	it("aggregates browser cleanup failure without retrying the remote mutation", async () => {
		clearLocalAccountStateMock.mockResolvedValueOnce(false);

		await expect(
			changeEmail({
				email: "new@example.com",
				password: "current-password",
			}),
		).resolves.toEqual({
			remoteApplied: true,
			localCleanupComplete: false,
		});
		expect(callMethodMock).toHaveBeenCalledOnce();
	});
});
