import { expect, type Page, test } from "@playwright/test";

import { installTauriShim } from "./support/app";

const TEXT_FIELDS = [
	"Display name",
	"About me",
	"Height",
	"Weight",
	"Last tested",
	"Instagram",
	"X",
	"Facebook",
];
const DROPDOWNS = [
	"Position",
	"Body type",
	"Ethnicity",
	"Relationship status",
	"My tribes",
	"Tribes I'm into",
	"Looking for",
	"Meet at",
	"Accept NSFW pics",
	"HIV status",
	"Sexual health practices",
	"Vaccines",
];
const COMBOBOXES = ["Tags", "Gender", "Pronouns"];

const fieldLabel = (page: Page, name: string) =>
	page
		.locator('[data-slot="label"]')
		.filter({ hasText: new RegExp(`^${name}$`) });
const dropdown = (page: Page, name: string) =>
	page.getByRole("button", { name: new RegExp(`^${name} `) });
const combobox = (page: Page, name: string) =>
	page.getByRole("combobox", { name, exact: true });

async function nextFrame(page: Page): Promise<void> {
	await page.evaluate(
		() => new Promise((framed) => requestAnimationFrame(framed)),
	);
}

test.beforeEach(async ({ page }) => {
	await installTauriShim(page);
	await page.goto("/settings/profile");
	await fieldLabel(page, "Display name").waitFor({ timeout: 60_000 });
});

test("tapping a text field's label focuses the field", async ({ page }) => {
	for (const name of TEXT_FIELDS) {
		await fieldLabel(page, name).click();
		await expect(page.getByLabel(name, { exact: true })).toBeFocused();
	}
});

test("every picker takes its name from its label", async ({ page }) => {
	for (const name of DROPDOWNS)
		await expect(dropdown(page, name)).toBeVisible();
	for (const name of COMBOBOXES)
		await expect(combobox(page, name)).toBeVisible();
	await expect(page.getByRole("slider", { name: "Age" })).toBeVisible();

	await combobox(page, "Tags").click();
	await expect(page.getByRole("listbox", { name: "Tags" })).toBeVisible();
});

test("tapping a picker's label leaves the picker closed", async ({ page }) => {
	for (const [name, picker] of [
		["Position", dropdown(page, "Position")],
		["Tags", combobox(page, "Tags")],
	] as const) {
		await fieldLabel(page, name).click();
		await nextFrame(page);
		expect(await picker.getAttribute("aria-expanded")).toBe("false");

		await picker.click();
		await expect(picker).toHaveAttribute("aria-expanded", "true");
		await page.keyboard.press("Escape");
		await expect(picker).toHaveAttribute("aria-expanded", "false");
	}
});
