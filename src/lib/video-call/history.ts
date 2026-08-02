import type { VideoCallMessage } from "$lib/model/messaging/messages";

export type VideoCallHistoryPresentation = {
	title: string;
	description: string | null;
};

function normalizeResult(result: string | null): string {
	return result?.replaceAll("_", " ").trim().toLocaleLowerCase() ?? "";
}

function formatDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function videoCallHistoryPresentation(
	body: VideoCallMessage["body"],
	options: { outgoing: boolean },
): VideoCallHistoryPresentation {
	const result = normalizeResult(body.result);
	let title: string;
	if (result === "successful" || result === "duration:") {
		title = "Video call completed";
	} else if (result === "busy") {
		title = "Video call busy";
	} else if (result === "cancelled" || result === "canceled") {
		title = "Video call cancelled";
	} else if (result === "declined") {
		title = "Video call declined";
	} else if (
		result === "no answer" ||
		result === "unanswered" ||
		(result === "missed" && options.outgoing)
	) {
		title = "Video call unanswered";
	} else if (result === "missed") {
		title = "Missed video call";
	} else if (result === "ab unsupported" || result === "lite unsupport") {
		title = "Video call unavailable";
	} else {
		title = "Video call";
	}

	return {
		title,
		description:
			body.videoCallDuration === null
				? null
				: `Duration ${formatDuration(body.videoCallDuration)}`,
	};
}
