// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import AlertDialog from "$lib/components/ui/alert-dialog/alert-dialog.svelte";
import Dialog from "$lib/components/ui/dialog/dialog.svelte";
import Drawer from "$lib/components/ui/drawer/drawer.svelte";
import Sheet from "$lib/components/ui/sheet/sheet.svelte";
import { backLayerManager } from "$lib/navigation/app-navigation";
import BackLayerRootHarness from "./back-layer-root.test-harness.svelte";

describe.each([
	["Drawer", Drawer],
	["Dialog", Dialog],
	["AlertDialog", AlertDialog],
	["Sheet", Sheet],
])("%s Back integration", (_name, Root) => {
	afterEach(() => {
		cleanup();
		expect(backLayerManager.size).toBe(0);
	});

	it("closes the bindable open state and unregisters across close and destroy", async () => {
		const view = render(BackLayerRootHarness, { Root });
		await waitFor(() => expect(backLayerManager.size).toBe(1));

		await expect(backLayerManager.handleBack()).resolves.toBe("handled");
		await waitFor(() => {
			expect(view.getByTestId("open-state").textContent).toBe("closed");
			expect(backLayerManager.size).toBe(0);
		});

		await fireEvent.click(view.getByRole("button", { name: "Reopen" }));
		await waitFor(() => expect(backLayerManager.size).toBe(1));
		view.unmount();
		expect(backLayerManager.size).toBe(0);
	});
});
