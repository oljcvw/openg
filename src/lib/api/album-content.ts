import type { AlbumContentResponse } from "$lib/api/album";
import type { ConversationState } from "$lib/chat/conversations.svelte.ts";
import type { AlbumMessage } from "$lib/model/message";

type SendAlbumContentArgs = {
	conversationState: ConversationState;
	/** The body of the album message the lightbox is showing. */
	albumMessageBody: AlbumMessage["body"];
	/** The slide the user is currently viewing in the lightbox. */
	slide: AlbumContentResponse["content"][number];
};

/**
 * Send an album-content reaction (a "tap" on a specific album slide).
 *
 * Routes through `ConversationState.send` so the message is optimistically
 * inserted into the chat thread and reconciled with the server response.
 */
export function sendAlbumContentReaction({
	conversationState,
	albumMessageBody,
	slide,
}: SendAlbumContentArgs): void {
	conversationState.send({
		type: "AlbumContentReaction",
		body: {
			albumId: albumMessageBody.albumId,
			ownerProfileId: albumMessageBody.ownerProfileId,
			albumContentId: slide.contentId,
			previewUrl: slide.thumbUrl,
			expiresAt: albumMessageBody.expiresAt ?? null,
			viewable: albumMessageBody.isViewable,
		},
	});
}

/**
 * Send an album-content reply (a text reply to a specific album slide).
 *
 * Routes through `ConversationState.send` so the message is optimistically
 * inserted into the chat thread and reconciled with the server response.
 */
export function sendAlbumContentReply({
	conversationState,
	albumMessageBody,
	slide,
	text,
}: SendAlbumContentArgs & { text: string }): void {
	conversationState.send({
		type: "AlbumContentReply",
		body: {
			albumId: albumMessageBody.albumId,
			ownerProfileId: albumMessageBody.ownerProfileId,
			albumContentId: slide.contentId,
			previewUrl: slide.thumbUrl,
			expiresAt: albumMessageBody.expiresAt ?? null,
			viewable: albumMessageBody.isViewable,
			albumContentReply: text,
			contentType: slide.contentType,
		},
	});
}