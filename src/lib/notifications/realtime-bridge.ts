import {
	acknowledgeNotification,
	type NotificationSource,
} from "$lib/api/notifications";
import type { RealtimeClient, RealtimeEvent } from "$lib/realtime";
import { createNotificationService } from "$lib/notifications/native";

export const realtimeNotificationTypes = [
	"chat.v1.message_sent",
	"tap.v1.tap_sent",
	"viewed_me.v1.new_view_received",
] as const;

type NotificationService = {
	notify(event: RealtimeEvent): Promise<boolean>;
};

type RealtimeNotificationClient = Pick<RealtimeClient, "on">;

export function bindRealtimeNotifications({
	client,
	notificationService = createNotificationService(),
	acknowledge = acknowledgeNotification,
}: {
	client: RealtimeNotificationClient;
	notificationService?: NotificationService;
	acknowledge?: (options: {
		notificationId: string;
		source: NotificationSource;
	}) => Promise<unknown>;
}) {
	const unsubscribes = realtimeNotificationTypes.map((type) =>
		client.on(type, (event) => {
			void handleRealtimeNotification(event, notificationService, acknowledge);
		}),
	);

	return () => {
		for (const unsubscribe of unsubscribes) unsubscribe();
	};
}

async function handleRealtimeNotification(
	event: RealtimeEvent,
	notificationService: NotificationService,
	acknowledge: (options: {
		notificationId: string;
		source: NotificationSource;
	}) => Promise<unknown>,
) {
	const displayed = await notificationService.notify(event);
	const notificationId = getNotificationId(event);
	if (displayed && notificationId) {
		await acknowledge({ notificationId, source: "WEBSOCKET" });
	}
}

function getNotificationId(event: RealtimeEvent) {
	if (
		"notificationId" in event &&
		typeof event.notificationId === "string" &&
		event.notificationId
	) {
		return event.notificationId;
	}
}
