import { expect, test } from "@playwright/test";

import { DEMO_CONVERSATION, installTauriShim } from "./support/app";

test("camera control sits left of the composer and opens capture choices", async ({
	page,
}) => {
	await installTauriShim(page);
	await page.goto(DEMO_CONVERSATION);

	const textarea = page.locator("textarea");
	const camera = page.getByRole("button", { name: "Open camera" });
	const attachments = page.getByRole("button", { name: "Open attachments" });
	await expect(textarea).toBeVisible({ timeout: 30_000 });
	await expect(camera).toBeVisible();
	await expect(attachments).toBeVisible();

	const [textareaBox, cameraBox, attachmentsBox] = await Promise.all([
		textarea.boundingBox(),
		camera.boundingBox(),
		attachments.boundingBox(),
	]);
	expect(textareaBox).not.toBeNull();
	expect(cameraBox).not.toBeNull();
	expect(attachmentsBox).not.toBeNull();
	expect(cameraBox!.x).toBeLessThan(textareaBox!.x + textareaBox!.width / 2);
	expect(attachmentsBox!.x).toBeGreaterThan(
		textareaBox!.x + textareaBox!.width / 2,
	);

	await camera.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Camera", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Short video" })).toBeVisible();
});
