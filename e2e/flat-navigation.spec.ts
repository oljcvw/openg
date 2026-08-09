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
