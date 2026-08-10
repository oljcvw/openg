// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
	activateAccountSession,
	invalidateAccountSession,
} from "$lib/api/account-caches";
import {
	addTranscriptRestorationCancellationListeners,
	canCaptureTranscriptViewport,
	isTranscriptRestorationCurrent,
	nextTranscriptSeenTimestamp,
	restoreMeasuredTranscript,
	transcriptRestorationCancellationState,
} from "./transcript-restoration";

describe("measured transcript restoration", () => {
	it("keeps restoring the floor until two measured frames prove it", async () => {
		const distances = [420, 180, 12, 10];
		const scrollToFloor = vi.fn();
		const outcome = await restoreMeasuredTranscript({
			target: { kind: "floor" },
			generation: 3,
			isCurrent: (generation) => generation === 3,
			measure: () => ({
				anchorOffsetPx: null,
				floorDistancePx: distances.shift() ?? 10,
			}),
			scrollToAnchor: vi.fn(() => Promise.resolve(false)),
			scrollToFloor,
			waitFrame: () => Promise.resolve(),
		});

		expect(outcome).toBe("restored");
		expect(scrollToFloor.mock.calls.length).toBeGreaterThan(1);
	});

	it("falls back from an unavailable anchor to a verified floor", async () => {
		const outcome = await restoreMeasuredTranscript({
			target: {
				kind: "anchor",
				messageId: "missing-message",
				offsetPx: 24,
				distanceFromEndPx: 500,
			},
			generation: 7,
			isCurrent: () => true,
			measure: () => ({ anchorOffsetPx: null, floorDistancePx: 0 }),
			scrollToAnchor: vi.fn(() => Promise.resolve(false)),
			scrollToFloor: vi.fn(),
			waitFrame: () => Promise.resolve(),
		});

		expect(outcome).toBe("anchorUnavailable");
	});

	it("cancels without touching a replacement conversation", async () => {
		let current = true;
		const scrollToFloor = vi.fn(() => {
			current = false;
		});
		const outcome = await restoreMeasuredTranscript({
			target: { kind: "floor" },
			generation: 1,
			isCurrent: () => current,
			measure: () => ({ anchorOffsetPx: null, floorDistancePx: 0 }),
			scrollToAnchor: vi.fn(() => Promise.resolve(false)),
			scrollToFloor,
			waitFrame: () => Promise.resolve(),
		});

		expect(outcome).toBe("superseded");
		expect(scrollToFloor).toHaveBeenCalledOnce();
	});

	it("gives deferred anchor work a current-generation fence", async () => {
		let current = true;
		let fenceChecks = 0;
		let fenceProvided = false;
		const outcome = await restoreMeasuredTranscript({
			target: {
				kind: "anchor",
				messageId: "message-a",
				offsetPx: 24,
				distanceFromEndPx: 500,
			},
			generation: 5,
			isCurrent: () => current,
			measure: () => ({ anchorOffsetPx: null, floorDistancePx: 0 }),
			scrollToAnchor: (_messageId, _offsetPx, stillCurrent) => {
				fenceProvided = typeof stillCurrent === "function";
				current = false;
				fenceChecks += Number(stillCurrent?.() ?? false);
				return false;
			},
			scrollToFloor: () => {},
			waitFrame: () => Promise.resolve(),
		});

		expect(outcome).toBe("superseded");
		expect(fenceProvided).toBe(true);
		expect(fenceChecks).toBe(0);
	});

	it("contains a rejected restoration dependency as a failed outcome", async () => {
		const outcome = await restoreMeasuredTranscript({
			target: { kind: "floor" },
			generation: 11,
			isCurrent: (generation) => generation === 11,
			measure: () => ({ anchorOffsetPx: null, floorDistancePx: 0 }),
			scrollToAnchor: () => Promise.resolve(false),
			scrollToFloor: () => {},
			waitFrame: () => Promise.reject(new Error("frame unavailable")),
		});

		expect(outcome).toBe("failed");
	});

	it("keeps viewport state provisional until measured restoration completes", () => {
		expect(canCaptureTranscriptViewport(false, false)).toBe(false);
		expect(canCaptureTranscriptViewport(false, true)).toBe(false);
		expect(canCaptureTranscriptViewport(true, false)).toBe(true);
		expect(
			nextTranscriptSeenTimestamp({
				atFloor: true,
				latestTimestamp: 200,
				restorationComplete: false,
				seenTimestamp: 100,
			}),
		).toBe(100);
		expect(
			nextTranscriptSeenTimestamp({
				atFloor: true,
				latestTimestamp: 200,
				restorationComplete: true,
				seenTimestamp: 100,
			}),
		).toBe(200);
	});

	it("cancels restoration for every transcript scrolling input", () => {
		const container = document.createElement("div");
		const cancel = vi.fn();
		const release = addTranscriptRestorationCancellationListeners(
			container,
			cancel,
		);

		container.dispatchEvent(new WheelEvent("wheel"));
		container.dispatchEvent(new Event("touchstart"));
		container.dispatchEvent(new Event("pointerdown"));
		container.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
		container.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

		expect(cancel).toHaveBeenCalledTimes(4);
		release();
		container.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
		expect(cancel).toHaveBeenCalledTimes(4);
	});

	it("invalidates pending restoration with its captured account session", () => {
		const accountSession = activateAccountSession(301);
		expect(
			isTranscriptRestorationCurrent({
				accountSession,
				candidateGeneration: 4,
				ownsContainer: true,
				ownsConversationState: true,
				restoreGeneration: 4,
			}),
		).toBe(true);

		invalidateAccountSession();

		expect(
			isTranscriptRestorationCurrent({
				accountSession,
				candidateGeneration: 4,
				ownsContainer: true,
				ownsConversationState: true,
				restoreGeneration: 4,
			}),
		).toBe(false);
	});

	it("remeasures whether cancellation ended at the transcript floor", () => {
		expect(transcriptRestorationCancellationState(480)).toEqual({
			atFloor: false,
			restorationComplete: true,
		});
		expect(transcriptRestorationCancellationState(8)).toEqual({
			atFloor: true,
			restorationComplete: true,
		});
	});
});
