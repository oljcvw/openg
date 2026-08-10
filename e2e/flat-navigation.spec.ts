import { expect, type Page, test } from "@playwright/test";

import { installTauriShim } from "./support/app";

const ROOTS = [
	{ name: "Browse", path: "/" },
	{ name: "Right Now", path: "/right-now" },
	{ name: "Interest", path: "/interest/taps" },
	{ name: "Inbox", path: "/chat" },
] as const;

async function openDemo(
	page: Page,
	path = "/",
	initialFiles: Record<string, number[]> = {},
): Promise<void> {
	await installTauriShim(page, initialFiles);
	await page.goto(path);
	await expect(page.getByRole("navigation").last()).toBeVisible({
		timeout: 30_000,
	});
}

function rootLink(page: Page, name: (typeof ROOTS)[number]["name"]) {
	return page.getByRole("link", { name, exact: true }).last();
}

async function activateRoot(
	page: Page,
	name: (typeof ROOTS)[number]["name"],
): Promise<void> {
	const link = rootLink(page, name);
	await link.waitFor();
	// Native click keeps this behavioral while avoiding transient error toasts
	// intercepting pointer input over the fixed bottom navigation.
	await link.evaluate((element: HTMLAnchorElement) => element.click());
}

for (const viewport of [
	{ label: "phone", width: 420, height: 800 },
	{ label: "narrow", width: 300, height: 800 },
	{ label: "minimum", width: 250, height: 800 },
	{ label: "desktop", width: 900, height: 800 },
]) {
	test(`root tabs replace in place at ${viewport.label} width`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await openDemo(page);
		const initialHistoryLength = await page.evaluate(() => history.length);

		for (const root of ROOTS.slice(1)) {
			await activateRoot(page, root.name);
			await expect(page).toHaveURL(
				new RegExp(`${root.path.replace("/", "\\/")}$`),
			);
			await expect(rootLink(page, root.name)).toHaveAttribute(
				"data-active",
				"true",
			);
		}

		expect(await page.evaluate(() => history.length)).toBe(
			initialHistoryLength,
		);
		await activateRoot(page, "Browse");
		await expect(page).toHaveURL(/\/$/);
		await expect(rootLink(page, "Browse")).toHaveAttribute(
			"data-active",
			"true",
		);
	});
}

test("Right Now profile closes to its feed and root activation returns to Browse", async ({
	page,
}) => {
	await openDemo(page, "/right-now");
	const post = page.getByRole("article", { name: /Right Now post by/ }).first();
	await expect(post).toBeVisible({ timeout: 30_000 });
	await post.getByRole("link", { name: /^View / }).click();
	await expect(page).toHaveURL(/\/profile\/\d+$/);

	await page.getByRole("button", { name: "Back to previous screen" }).click();
	await expect(page).toHaveURL(/\/right-now$/);
	await expect(post).toBeVisible();

	await activateRoot(page, "Browse");
	await expect(page).toHaveURL(/\/$/);
});

test("Interest sibling sections replace without accumulating history", async ({
	page,
}) => {
	await openDemo(page, "/interest/taps");
	const sections = page.locator("nav[data-fixed-header]");
	await expect(sections.getByRole("link", { name: "Taps" })).toBeVisible();
	const initialHistoryLength = await page.evaluate(() => history.length);
	await sections.getByRole("link", { name: "Views" }).click();
	await expect(page).toHaveURL(/\/interest\/views$/);
	await expect(
		page.locator("nav[data-fixed-header]").getByRole("link", { name: "Views" }),
	).toBeVisible();
	expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength);
});

test("Right Now media viewer closes on Escape and restores opener focus", async ({
	page,
}) => {
	await openDemo(page, "/right-now");
	const opener = page.getByRole("link", { name: /^Open image from / }).first();
	await expect(opener).toBeVisible({ timeout: 30_000 });
	await opener.click();
	const viewer = page.locator(".pswp");
	await expect(viewer).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(viewer).toBeHidden();
	await expect(opener).toBeFocused();
	await expect(page).toHaveURL(/\/right-now$/);
});

test("rendered Right Now DOM stays bounded", async ({ page }) => {
	await openDemo(page, "/right-now");
	await expect(page.getByRole("article").first()).toBeVisible({
		timeout: 30_000,
	});
	const mountedPosts = await page.getByRole("article").count();
	expect(mountedPosts).toBeGreaterThan(0);
	expect(mountedPosts).toBeLessThan(30);
});

test("serial Inbox conversations replace one detail and Back returns to Inbox", async ({
	page,
}) => {
	const conversationA = "/chat/100001:123456000";
	const conversationB = "/chat/100006:123456000";
	const pageErrors: Error[] = [];
	page.on("pageerror", (error) => pageErrors.push(error));

	await page.setViewportSize({ width: 900, height: 800 });
	await openDemo(page, "/chat");
	const rowA = page.locator(`a[href="${conversationA}"]:visible`).first();
	const rowB = page.locator(`a[href="${conversationB}"]:visible`).first();
	await expect(rowA).toBeVisible({ timeout: 30_000 });
	await expect(rowB).toBeVisible({ timeout: 30_000 });

	await rowA.click();
	await rowB.click();
	await expect(page).toHaveURL(new RegExp(`${conversationB}$`));
	await expect(rowB).toHaveAttribute("aria-current", "page");
	await expect(rowA).not.toHaveAttribute("aria-current", "page");
	await expect(
		page.getByRole("button", { name: "Back to conversations" }),
	).toHaveCount(1);
	await expect(page.getByRole("textbox")).toHaveCount(1);

	const transcript = page.getByRole("region", {
		name: "Conversation messages",
	});
	await expect(transcript).toBeVisible();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	expect(
		await transcript.evaluate(
			(element) =>
				element.scrollHeight - element.clientHeight - element.scrollTop,
		),
	).toBeLessThanOrEqual(16);
	await expect(
		page.getByText("Something went wrong", { exact: true }),
	).toHaveCount(0);
	expect(pageErrors).toHaveLength(0);

	await page.getByRole("button", { name: "Back to conversations" }).click();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(
		page.getByRole("button", { name: "Back to conversations" }),
	).toHaveCount(0);
	await expect(page.getByRole("textbox")).toHaveCount(0);
	await expect(
		page.getByText("Select a conversation to start chatting", { exact: true }),
	).toBeVisible();
});

test("browser Back and Forward traverse an app-owned conversation detail", async ({
	page,
}) => {
	const conversation = "/chat/100001:123456000";
	await page.setViewportSize({ width: 900, height: 800 });
	await openDemo(page, "/chat");
	const row = page.locator(`a[href="${conversation}"]:visible`).first();
	await expect(row).toBeVisible({ timeout: 30_000 });

	await row.click();
	await expect(page).toHaveURL(new RegExp(`${conversation}$`));
	await page.goBack();
	await expect(page).toHaveURL(/\/chat$/);
	await expect(
		page.getByRole("button", { name: "Back to conversations" }),
	).toHaveCount(0);

	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`${conversation}$`));
	await expect(
		page.getByRole("button", { name: "Back to conversations" }),
	).toHaveCount(1);
});
