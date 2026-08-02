import { describe, expect, it } from "vitest";

import { videoCallHistoryPresentation } from "$lib/video-call/history";

describe("video-call history presentation", () => {
	it("renders successful calls with duration", () => {
		expect(
			videoCallHistoryPresentation(
				{ result: "SUCCESSFUL", videoCallDuration: 65 },
				{ outgoing: true },
			),
		).toEqual({
			title: "Video call completed",
			description: "Duration 1:05",
		});
	});

	it("distinguishes incoming missed calls from outgoing unanswered calls", () => {
		expect(
			videoCallHistoryPresentation(
				{ result: "Missed", videoCallDuration: null },
				{ outgoing: false },
			).title,
		).toBe("Missed video call");
		expect(
			videoCallHistoryPresentation(
				{ result: "Missed", videoCallDuration: null },
				{ outgoing: true },
			).title,
		).toBe("Video call unanswered");
	});

	it.each([
		["Busy", "Video call busy"],
		["DECLINED", "Video call declined"],
		["No_Answer", "Video call unanswered"],
		["AB_Unsupported", "Video call unavailable"],
	] as const)("maps %s outcome", (result, title) => {
		expect(
			videoCallHistoryPresentation(
				{ result, videoCallDuration: null },
				{ outgoing: false },
			),
		).toEqual({ title, description: null });
	});
});
