export function canUnsendMessage(
	message: {
		messageId: string;
		status?: string;
		type: string;
		unsent: boolean;
	},
	isOut: boolean,
): boolean {
	return (
		isOut &&
		message.status === "sent" &&
		!message.messageId.startsWith("pending-") &&
		!message.unsent &&
		message.type !== "Retract" &&
		message.type !== "VideoCall"
	);
}
