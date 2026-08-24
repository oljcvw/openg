import { expect, test } from "@playwright/test";

import { installTauriShim } from "./support/app";

test("conversation search matches names and complete message history", async ({
	page,
}) => {
	await installTauriShim(page);
	await page.goto("/chat");

	const search = page.getByRole("searchbox", {
		name: "Search conversations",
	});
	await search.waitFor({ timeout: 30_000 });
	const conversationRows = page.locator(
		'[data-slot="item"]:has(a[href^="/chat/"])',
	);
	await conversationRows.first().waitFor({ timeout: 30_000 });
	const initialCount = await conversationRows.count();
	expect(initialCount).toBeGreaterThan(1);

	await search.fill("Archived nebula handshake");
	await expect(conversationRows).toHaveCount(1);
	await expect(conversationRows.first()).toContainText(
		"Archived nebula handshake",
	);
	await expect(conversationRows.first()).not.toContainText("Match:");

	await search.fill("no such conversation");
	await expect(
		page.getByRole("heading", { name: "No matching conversations" }),
	).toBeVisible();

	await search.clear();
	await expect(conversationRows).toHaveCount(initialCount);

	await search.fill("Archived nebula handshake");
	await expect(conversationRows).toHaveCount(1);
	await page
		.getByRole("link", { name: /Archived nebula handshake/u })
		.click();
	await expect(page).toHaveURL(/\/chat\/[^?]+\?messageId=.+/u);
	const targetMessage = page.locator(
		'[data-slot="message"][data-search-target]',
	);
	await expect(targetMessage).toContainText("Archived nebula handshake");
	const scroller = page.locator('[data-slot="messages-scroller"]');
	await expect
		.poll(async () => {
			const targetBox = await targetMessage.boundingBox();
			const scrollerBox = await scroller.boundingBox();
			if (!targetBox || !scrollerBox) return Number.POSITIVE_INFINITY;
			return Math.abs(
				targetBox.y +
					targetBox.height / 2 -
					(scrollerBox.y + scrollerBox.height / 2),
			);
		})
		.toBeLessThan(80);
});
