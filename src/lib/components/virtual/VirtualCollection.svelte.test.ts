import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import VirtualCollectionHarness from "./VirtualCollection.test-harness.svelte";

afterEach(cleanup);

describe("VirtualCollection", () => {
	it("bounds the mounted DOM for a deterministic 1,000-item fixture", async () => {
		const view = render(VirtualCollectionHarness, { count: 1_000 });

		await waitFor(() => {
			const mounted = view.container.querySelectorAll("[data-fixture-item]");
			expect(mounted.length).toBeGreaterThan(0);
			expect(mounted.length).toBeLessThanOrEqual(20);
		});
	});

	it("uses stable item keys in the mounted window", async () => {
		const view = render(VirtualCollectionHarness, { count: 1_000 });

		await waitFor(() => {
			const keys = [
				...view.container.querySelectorAll<HTMLElement>("[data-virtual-key]"),
			].map((node) => node.dataset.virtualKey);
			expect(keys.length).toBeGreaterThan(0);
			expect(new Set(keys).size).toBe(keys.length);
		});
	});

	it("bounds the mounted DOM for a deterministic 10,000-item fixture", async () => {
		const view = render(VirtualCollectionHarness, { count: 10_000 });

		await waitFor(() => {
			const mounted = view.container.querySelectorAll("[data-fixture-item]");
			expect(mounted.length).toBeGreaterThan(0);
			expect(mounted.length).toBeLessThanOrEqual(20);
		});
	});
});
