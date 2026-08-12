import {
	type ApiResponseMessage,
	videoMessageSchema,
} from "$lib/model/messaging/messages";

export type SharedMediaMessageType =
	| "Image"
	| "ExpiringImage"
	| "Video"
	| "PrivateVideo"
	| "NonExpiringVideo";

export type SharedMediaEntry = {
	accountProfileId: number;
	conversationId: string;
	peerProfileId: number;
	messageId: string;
	mediaId: string;
	kind: "image" | "video";
	messageType: SharedMediaMessageType;
	sentAt: number;
	remoteAvailability: "available" | "expired" | "views_exhausted" | "retracted";
	cacheAvailability: "cached" | "not_cached" | "evicted";
	cacheToken: string | null;
	/** True when showing the tile must not authorize or preload the media. */
	consumptive: boolean;
	/** Transient only. Durable shared-media records must strip signed URLs. */
	remoteUrl: string | null;
};

export type SharedMediaContext = {
	accountProfileId: number;
	conversationId: string;
	peerProfileId: number;
};

export function isReceivedFromConversationPeer(options: {
	accountProfileId: number;
	peerProfileId: number | null;
	senderProfileId: number;
	isOut: boolean;
}): boolean {
	return (
		!options.isOut &&
		options.peerProfileId !== null &&
		options.peerProfileId !== options.accountProfileId &&
		options.senderProfileId === options.peerProfileId
	);
}

export function galleryPlayableUrl(
	entry: Pick<SharedMediaEntry, "consumptive" | "remoteUrl">,
	cachedUrl: string | null,
): string | null {
	return cachedUrl ?? (entry.consumptive ? null : entry.remoteUrl);
}

export function classifyReceivedSharedMedia(
	message: ApiResponseMessage,
	context: SharedMediaContext,
): SharedMediaEntry | null {
	if (
		message.unsent ||
		message.conversationId !== context.conversationId ||
		message.senderId !== context.peerProfileId
	) {
		return null;
	}

	let mediaId: number | null;
	let kind: SharedMediaEntry["kind"];
	let messageType: SharedMediaMessageType;
	let remoteUrl: string | null;
	let viewsRemaining: number | null | undefined;
	let consumptive: boolean;

	if (message.type === "Image" || message.type === "ExpiringImage") {
		mediaId = message.body.mediaId;
		kind = "image";
		messageType = message.type;
		remoteUrl = message.body.url;
		viewsRemaining =
			message.type === "ExpiringImage"
				? message.body.viewsRemaining
				: undefined;
		consumptive = message.type === "ExpiringImage";
	} else if (message.type === "Video" || message.type === "PrivateVideo") {
		mediaId = message.body.mediaId;
		kind = "video";
		messageType = message.type;
		remoteUrl = message.body.url;
		viewsRemaining = message.body.viewsRemaining;
		consumptive = message.body.maxViews !== null;
	} else if (message.type === "NonExpiringVideo") {
		const parsed = videoMessageSchema.shape.body.safeParse(message.body);
		if (!parsed.success) return null;
		mediaId = parsed.data.mediaId;
		kind = "video";
		messageType = "NonExpiringVideo";
		remoteUrl = parsed.data.url;
		viewsRemaining = parsed.data.viewsRemaining;
		consumptive = parsed.data.maxViews !== null;
	} else {
		return null;
	}

	if (mediaId === null) return null;
	return {
		accountProfileId: context.accountProfileId,
		conversationId: context.conversationId,
		peerProfileId: context.peerProfileId,
		messageId: message.messageId,
		mediaId: String(mediaId),
		kind,
		messageType,
		sentAt: message.timestamp,
		remoteAvailability: viewsRemaining === 0 ? "views_exhausted" : "available",
		cacheAvailability: "not_cached",
		cacheToken: null,
		consumptive,
		remoteUrl,
	};
}
