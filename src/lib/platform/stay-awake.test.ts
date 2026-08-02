import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	delete window.__AndroidScreen;
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("applyStayAwake", () => {
	it("uses the narrow Android bridge when available", async () => {
		const setStayAwake = vi.fn();
		window.__AndroidScreen = { setStayAwake };
		const { applyStayAwake } = await import("./stay-awake");

		await applyStayAwake(true);
		await applyStayAwake(false);

		expect(setStayAwake).toHaveBeenNthCalledWith(1, true);
		expect(setStayAwake).toHaveBeenNthCalledWith(2, false);
	});

	it("requests and releases the browser screen wake lock", async () => {
		const release = vi.fn(() => Promise.resolve());
		const sentinel = {
			released: false,
			release,
			addEventListener: vi.fn(),
		} as unknown as WakeLockSentinel;
		const request = vi.fn(() => Promise.resolve(sentinel));
		Object.defineProperty(navigator, "wakeLock", {
			configurable: true,
			value: { request },
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		const { applyStayAwake } = await import("./stay-awake");

		await applyStayAwake(true);
		await applyStayAwake(false);

		expect(request).toHaveBeenCalledWith("screen");
		expect(release).toHaveBeenCalledOnce();
	});
});
