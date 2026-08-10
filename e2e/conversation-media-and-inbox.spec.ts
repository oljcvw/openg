import { expect, type Page, test } from "@playwright/test";

import {
	DEMO_CONVERSATION,
	installTauriShim,
	TrustedTouch,
} from "./support/app";

async function openDemo(page: Page, path: string): Promise<Error[]> {
	const pageErrors: Error[] = [];
	page.on("pageerror", (error) => pageErrors.push(error));
	await installTauriShim(page);
	await page.goto(path);
	return pageErrors;
}

test("received Albums rows expose separate drawer and full-screen actions", async ({
	page,
}) => {
	const pageErrors = await openDemo(page, "/albums");
	await expect(
		page.getByRole("heading", { name: "Received albums" }),
	).toBeVisible({ timeout: 30_000 });
	const rows = page.getByRole("article");
	await expect(rows).toHaveCount(6);

	const firstRow = rows.first();
	await expect(firstRow.getByText("New", { exact: true })).toBeVisible();
	await firstRow.getByRole("button", { name: "Open received album" }).click();
	const drawer = page.getByRole("dialog");
	await expect(drawer).toBeVisible();
	await expect(
		drawer.getByRole("button", { name: "Close album drawer" }),
	).toBeVisible();
	await drawer.getByRole("button", { name: "Close album drawer" }).click();
	await expect(drawer).toBeHidden();

	const directMedia = firstRow.getByRole("button", {
		name: "Open album media 1",
	});
	await expect(directMedia).toBeEnabled();
	await directMedia.click();
	const viewer = page.getByRole("dialog", { name: "Media viewer" });
	await expect(viewer).toBeVisible();
	await expect(
		viewer.getByRole("button", { name: "Close media viewer" }),
	).toBeVisible();
	await expect(
		viewer.getByRole("status").filter({ hasText: /^1 \/ \d+$/ }),
	).toHaveCount(1);
	await viewer.getByRole("button", { name: "Close media viewer" }).click();
	await expect(viewer).toBeHidden();
	await expect(directMedia).toBeFocused();
	await expect(page).toHaveURL(/\/albums$/);
	expect(pageErrors).toHaveLength(0);
});

test("ordinary received image opens the conversation deck and Back restores it", async ({
	page,
}) => {
	const pageErrors = await openDemo(page, "/chat/100006:123456000");
	const opener = page.getByRole("button", { name: "Open image" });
	await expect(opener).toBeVisible({ timeout: 30_000 });
	await opener.click();
	const viewer = page.getByRole("dialog", { name: "Media viewer" });
	await expect(viewer).toBeVisible();
	await expect(
		viewer.getByRole("status").filter({ hasText: "2 / 2" }),
	).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(viewer).toBeHidden();
	await expect(opener).toBeFocused();

	const videoOpener = page.getByRole("button", {
		name: "Open video full screen",
	});
	await videoOpener.click();
	await expect(viewer).toBeVisible();
	const position = viewer.getByRole("status");
	await expect(position).toHaveText("1 / 2");
	await expect(viewer.locator("video[controls]")).toHaveCount(1);
	const box = await viewer.boundingBox();
	expect(box).not.toBeNull();
	const touch = await TrustedTouch.attach(page);
	await touch.drag(
		page,
		{ x: box!.x + box!.width * 0.8, y: box!.y + box!.height * 0.55 },
		{ x: box!.x + box!.width * 0.2, y: box!.y + box!.height * 0.55 },
	);
	await expect(position).toHaveText("2 / 2");
	await touch.drag(
		page,
		{ x: box!.x + box!.width * 0.8, y: box!.y + box!.height * 0.55 },
		{ x: box!.x + box!.width * 0.2, y: box!.y + box!.height * 0.55 },
	);
	await expect(position).toHaveText("2 / 2");
	await viewer.getByRole("button", { name: "Close media viewer" }).click();
	await expect(viewer).toBeHidden();
	await expect(videoOpener).toBeFocused();
	await expect(page).toHaveURL(/\/chat\/100006:123456000$/);
	expect(pageErrors).toHaveLength(0);
});

test("voice-note discovery enters at the newest note and exits before navigation", async ({
	page,
}) => {
	const pageErrors = await openDemo(page, DEMO_CONVERSATION);
	const actions = page.getByRole("button", { name: "Conversation actions" });
	await expect(actions).toBeVisible({ timeout: 30_000 });
	await actions.click();
	const voiceNotes = page.getByRole("menuitem", {
		name: "Voice notes",
		exact: true,
	});
	await expect(voiceNotes).toBeEnabled();
	await voiceNotes.click();

	const navigator = page.getByRole("toolbar", {
		name: "Voice note navigation",
	});
	await expect(navigator).toBeVisible();
	await expect(navigator.getByText("2 of 2", { exact: true })).toBeVisible();
	await expect(
		navigator.getByRole("button", { name: "Next voice note" }),
	).toBeDisabled();
	await navigator.getByRole("button", { name: "Previous voice note" }).click();
	await expect(navigator.getByText("1 of 2", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(navigator).toBeHidden();
	await expect(page).toHaveURL(new RegExp(`${DEMO_CONVERSATION}$`));
	expect(pageErrors).toHaveLength(0);
});

test("profile composer accepts a scoped draft without opening Inbox", async ({
	page,
}) => {
	const pageErrors = await openDemo(page, "/profile/100001");
	const composer = page.getByRole("textbox", { name: "Message this profile" });
	await expect(composer).toBeVisible({ timeout: 30_000 });
	await composer.fill("Demo-only draft");
	await expect(composer).toHaveValue("Demo-only draft");
	await expect(page).toHaveURL(/\/profile\/100001$/);
	await expect(
		page.getByRole("link", { name: "Open full conversation" }),
	).toBeVisible();
	expect(pageErrors).toHaveLength(0);
});

test("stacked Inbox preserves the list while a full-size conversation opens", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1000, height: 800 });
	const pageErrors = await openDemo(page, "/settings/app");
	await expect(page.getByText("App Settings", { exact: true })).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("radio", { name: "Stacked" }).click();
	await page.getByRole("radio", { name: "Roomy" }).click();

	await page.getByRole("link", { name: "Inbox", exact: true }).last().click();
	await expect(page).toHaveURL(/\/chat$/);
	const target = page
		.locator('a[href="/chat/100001:123456000"]:visible')
		.first();
	await expect(target).toBeVisible({ timeout: 30_000 });
	await target.click();
	await expect(page).toHaveURL(/\/chat\/100001:123456000$/);
	await expect(
		page.getByRole("button", { name: "Back to conversations" }),
	).toBeVisible();
	const hiddenList = page.locator('[aria-hidden="true"][inert]');
	await expect(hiddenList).toHaveCount(1);
	await page.getByRole("button", { name: "Back to conversations" }).click();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(target).toBeVisible();
	expect(pageErrors).toHaveLength(0);
});

test("Settings is the exclusive entry point for live albums and saved sets", async ({
	page,
}) => {
	const pageErrors = await openDemo(page, "/settings");
	const manage = page.getByRole("link", { name: /Manage albums/ });
	await expect(manage).toBeVisible({ timeout: 30_000 });
	await manage.click();
	await expect(page).toHaveURL(/\/settings\/albums$/);
	await expect(
		page.getByRole("heading", { name: "Live albums" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Save as set" }).first(),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Saved album sets" }),
	).toBeVisible();
	await expect(
		page
			.getByRole("note")
			.filter({ hasText: "Everyone who already has access" }),
	).toBeVisible();
	expect(pageErrors).toHaveLength(0);
});
