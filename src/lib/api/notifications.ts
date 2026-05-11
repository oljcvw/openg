import { fetchRest } from "$lib/api";

export type NotificationSource = "WEBSOCKET" | "PUSH";

export async function registerFcmPushToken(token: string) {
	return await fetchRest("/v3/gcm-push-tokens", {
		method: "POST",
		body: { token },
	});
}

export async function acknowledgeNotification({
	notificationId,
	source,
}: {
	notificationId: string;
	source?: NotificationSource;
}) {
	return await fetchRest("/public/v1/notifications/ack", {
		method: "POST",
		body: {
			notificationId,
			...(source ? { source } : {}),
		},
	});
}
