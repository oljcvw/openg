import { describe, expect, it } from "vitest";

import {
	createRuntimeOwnershipRegistry,
	getRuntimeOwnershipSnapshot,
	RUNTIME_OWNERSHIP_TYPES,
} from "$lib/dev/runtime-ownership";
import { BackLayerManager } from "$lib/navigation/navigation-foundations";

describe("runtime ownership registry", () => {
	it("returns to baseline after 100 navigation lifecycle cycles without identifiers", () => {
		const registry = createRuntimeOwnershipRegistry(true);
		const baseline = registry.snapshot();
		for (let index = 0; index < 100; index += 1) {
			const route = registry.acquire("navigation-runtime");
			const layer = registry.acquire("back-layer-registration");
			layer();
			layer();
			route();
		}
		expect(registry.snapshot()).toEqual(baseline);
		const serialized = JSON.stringify(registry.snapshot());
		const parsed = JSON.parse(serialized) as Record<string, unknown>;
		expect(Object.keys(parsed)).toEqual([...RUNTIME_OWNERSHIP_TYPES]);
		expect(
			Object.values(parsed).every((value) => typeof value === "number"),
		).toBe(true);
	});

	it("central back-layer ownership plateaus through 100 mount cycles", () => {
		const baseline = getRuntimeOwnershipSnapshot();
		const manager = new BackLayerManager();
		for (let index = 0; index < 100; index += 1) {
			const release = manager.register({
				priority: "drawer",
				handler: () => "handled",
			});
			release();
		}
		expect(manager.size).toBe(0);
		expect(getRuntimeOwnershipSnapshot()).toEqual(baseline);
	});
});
