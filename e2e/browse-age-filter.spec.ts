import { encode } from "@msgpack/msgpack";
import { expect, type Page, test } from "@playwright/test";

import { installTauriShim, TrustedTouch } from "./support/app";

async function openBrowseAgeFilter(page: Page) {
	await installTauriShim(page, {
		"preferences.data": [...encode({ geohash: "u2fkb88pbpbp" })],
	});
	await page.goto("/");
	await page.getByRole("button", { name: "Age" }).click();
	const drawer = page.locator("[data-vaul-drawer]");
	await drawer.waitFor();
	await page.waitForTimeout(700);
	return drawer;
}

test("Browse age slider stays anchored during touch drift", async ({
	page,
}) => {
	const drawer = await openBrowseAgeFilter(page);
	const slider = drawer.locator('[data-slot="slider"]');
	const firstThumb = slider.getByRole("slider").first();
	const beforeDrawer = await drawer.boundingBox();
	const sliderBox = await slider.boundingBox();
	const thumbBox = await firstThumb.boundingBox();
	expect(beforeDrawer).not.toBeNull();
	expect(sliderBox).not.toBeNull();
	expect(thumbBox).not.toBeNull();

	const touch = await TrustedTouch.attach(page);
	await touch.drag(
		page,
		{
			x: thumbBox!.x + thumbBox!.width / 2,
			y: thumbBox!.y + thumbBox!.height / 2,
		},
		{
			x: sliderBox!.x + sliderBox!.width * 0.35,
			y: sliderBox!.y + sliderBox!.height / 2 - 28,
		},
	);
	await page.waitForTimeout(250);

	const afterDrawer = await drawer.boundingBox();
	expect(afterDrawer).not.toBeNull();
	expect(Math.abs(afterDrawer!.y - beforeDrawer!.y)).toBeLessThanOrEqual(2);
	await expect(drawer).toBeVisible();
	await expect(firstThumb).toBeVisible();
});
