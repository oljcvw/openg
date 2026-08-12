import {
	type AccountSessionSnapshot,
	isAccountSessionCurrent,
} from "$lib/api/account-caches";

export type TranscriptRestoreTarget =
	| { kind: "floor" }
	| {
			kind: "anchor";
			messageId: string;
			offsetPx: number;
			distanceFromEndPx: number;
	  };

export type TranscriptRestoreOutcome =
	| "restored"
	| "anchorUnavailable"
	| "superseded"
	| "failed";

type TranscriptMeasurement = {
	floorDistancePx: number;
	anchorOffsetPx: number | null;
};

const FLOOR_SLOP_PX = 16;
const STABLE_MEASUREMENT_SLOP_PX = 2;
const MAX_MEASUREMENT_FRAMES = 5;
const TRANSCRIPT_SCROLL_KEYS = new Set([
	" ",
	"ArrowDown",
	"ArrowUp",
	"End",
	"Home",
	"PageDown",
	"PageUp",
]);

export function canCaptureTranscriptViewport(
	restorationComplete: boolean,
	restoring: boolean,
): boolean {
	return restorationComplete && !restoring;
}

export function isTranscriptRestorationCurrent({
	accountSession,
	candidateGeneration,
	ownsContainer,
	ownsConversationState,
	restoreGeneration,
}: {
	accountSession: AccountSessionSnapshot;
	candidateGeneration: number;
	ownsContainer: boolean;
	ownsConversationState: boolean;
	restoreGeneration: number;
}): boolean {
	return (
		candidateGeneration === restoreGeneration &&
		ownsContainer &&
		ownsConversationState &&
		isAccountSessionCurrent(accountSession)
	);
}

export function transcriptRestorationCancellationState(
	floorDistancePx: number,
): { atFloor: boolean; restorationComplete: true } {
	return {
		atFloor:
			Number.isFinite(floorDistancePx) && floorDistancePx <= FLOOR_SLOP_PX,
		restorationComplete: true,
	};
}

export function nextTranscriptSeenTimestamp({
	atFloor,
	latestTimestamp,
	restorationComplete,
	seenTimestamp,
}: {
	atFloor: boolean;
	latestTimestamp: number;
	restorationComplete: boolean;
	seenTimestamp: number;
}): number {
	return restorationComplete && atFloor
		? Math.max(seenTimestamp, latestTimestamp)
		: seenTimestamp;
}

export function addTranscriptRestorationCancellationListeners(
	container: HTMLElement,
	cancel: () => void,
): () => void {
	const cancelFromInput = () => cancel();
	const cancelFromKeyboard = (event: KeyboardEvent) => {
		if (TRANSCRIPT_SCROLL_KEYS.has(event.key)) cancel();
	};
	container.addEventListener("wheel", cancelFromInput, { passive: true });
	container.addEventListener("touchstart", cancelFromInput, { passive: true });
	container.addEventListener("pointerdown", cancelFromInput, { passive: true });
	container.addEventListener("keydown", cancelFromKeyboard);
	return () => {
		container.removeEventListener("wheel", cancelFromInput);
		container.removeEventListener("touchstart", cancelFromInput);
		container.removeEventListener("pointerdown", cancelFromInput);
		container.removeEventListener("keydown", cancelFromKeyboard);
	};
}

export async function restoreMeasuredTranscript({
	target,
	generation,
	isCurrent,
	measure,
	scrollToAnchor,
	scrollToFloor,
	waitFrame,
}: {
	target: TranscriptRestoreTarget;
	generation: number;
	isCurrent: (generation: number) => boolean;
	measure: (messageId: string | null) => TranscriptMeasurement;
	scrollToAnchor: (
		messageId: string,
		offsetPx: number,
		isCurrent: () => boolean,
	) => boolean | Promise<boolean>;
	scrollToFloor: () => void;
	waitFrame: () => Promise<void>;
}): Promise<TranscriptRestoreOutcome> {
	if (!isCurrent(generation)) return "superseded";

	try {
		let activeTarget = target;
		let anchorUnavailable = false;
		if (activeTarget.kind === "anchor") {
			const found = await scrollToAnchor(
				activeTarget.messageId,
				activeTarget.offsetPx,
				() => isCurrent(generation),
			);
			if (!isCurrent(generation)) return "superseded";
			if (!found) {
				anchorUnavailable = true;
				activeTarget = { kind: "floor" };
			}
		}
		if (activeTarget.kind === "floor") scrollToFloor();
		if (!isCurrent(generation)) return "superseded";

		let previousAcceptedValue: number | null = null;
		for (let frame = 0; frame < MAX_MEASUREMENT_FRAMES; frame += 1) {
			await waitFrame();
			if (!isCurrent(generation)) return "superseded";
			const measurement = measure(
				activeTarget.kind === "anchor" ? activeTarget.messageId : null,
			);
			const value =
				activeTarget.kind === "floor"
					? measurement.floorDistancePx
					: measurement.anchorOffsetPx;
			const accepted =
				value !== null &&
				Number.isFinite(value) &&
				(activeTarget.kind === "floor"
					? value <= FLOOR_SLOP_PX
					: Math.abs(value - activeTarget.offsetPx) <= FLOOR_SLOP_PX);
			if (
				accepted &&
				previousAcceptedValue !== null &&
				Math.abs(value - previousAcceptedValue) <= STABLE_MEASUREMENT_SLOP_PX
			)
				return anchorUnavailable ? "anchorUnavailable" : "restored";
			previousAcceptedValue = accepted ? value : null;

			if (activeTarget.kind === "floor") {
				scrollToFloor();
			} else if (
				!(await scrollToAnchor(
					activeTarget.messageId,
					activeTarget.offsetPx,
					() => isCurrent(generation),
				))
			) {
				anchorUnavailable = true;
				activeTarget = { kind: "floor" };
				scrollToFloor();
			}
			if (!isCurrent(generation)) return "superseded";
		}
		return "failed";
	} catch {
		return isCurrent(generation) ? "failed" : "superseded";
	}
}
