import { describe, expect, it, vi } from "vitest";

import { waitForProfileDismissAnimations } from "./profile-dismiss";

describe("waitForProfileDismissAnimations", () => {
	it("finishes immediately when reduced motion produces no animation", async () => {
		await expect(
			waitForProfileDismissAnimations(() => []),
		).resolves.toBeUndefined();
	});

	it("waits for the active dismiss animation without scheduling a delay", async () => {
		vi.useFakeTimers();
		let finishAnimation: (() => void) | undefined;
		const finished = new Promise<void>((resolve) => {
			finishAnimation = resolve;
		});
		let settled = false;

		const waiting = waitForProfileDismissAnimations(() => [{ finished }]).then(
			() => {
				settled = true;
			},
		);
		await Promise.resolve();

		expect(settled).toBe(false);
		expect(vi.getTimerCount()).toBe(0);

		finishAnimation?.();
		await waiting;
		expect(settled).toBe(true);
		vi.useRealTimers();
	});

	it("finishes when the browser cancels an active transition", async () => {
		await expect(
			waitForProfileDismissAnimations(() => [
				{ finished: Promise.reject(new Error("transition canceled")) },
			]),
		).resolves.toBeUndefined();
	});
});
