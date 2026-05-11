import {
	isPermissionGranted,
	requestPermission,
	sendNotification,
} from "@tauri-apps/plugin-notification";
import type { RealtimeEvent } from "$lib/realtime";

export type NativeNotification = {
	title: string;
	body?: string;
};

export type NotificationAdapter = {
	isPermissionGranted: () => Promise<boolean>;
	requestPermission: () => Promise<NotificationPermission>;
	sendNotification: (notification: NativeNotification) => void;
};

export const tauriNotificationAdapter: NotificationAdapter = {
	isPermissionGranted,
	requestPermission,
	sendNotification,
};

export function formatRealtimeNotification(
	event: RealtimeEvent,
): NativeNotification | undefined {
	switch (event.type) {
		case "chat.v1.message_sent":
			return {
				title: "New message",
				body: messagePreview(event.payload),
			};
		case "tap.v1.tap_sent":
			return {
				title: "New tap",
				body: `${displayName(event.payload)} tapped you`,
			};
		case "viewed_me.v1.new_view_received":
			return {
				title: "New profile view",
				body: "Someone viewed your profile",
			};
		default:
			return undefined;
	}
}

export function createNotificationService(
	adapter: NotificationAdapter = tauriNotificationAdapter,
) {
	return {
		async ensurePermission() {
			if (await adapter.isPermissionGranted()) return true;
			return (await adapter.requestPermission()) === "granted";
		},
		async notify(event: RealtimeEvent) {
			const notification = formatRealtimeNotification(event);
			if (!notification) return false;
			if (!(await this.ensurePermission())) return false;
			adapter.sendNotification(notification);
			return true;
		},
	};
}

function messagePreview(payload: unknown) {
	if (!payload || typeof payload !== "object") return "Open Grind message";
	const body = "body" in payload ? payload.body : undefined;
	if (body && typeof body === "object" && "text" in body) {
		const text = body.text;
		if (typeof text === "string" && text.trim()) return text;
	}
	return "Open Grind message";
}

function displayName(payload: unknown) {
	if (!payload || typeof payload !== "object") return "Someone";
	if ("senderDisplayName" in payload && typeof payload.senderDisplayName === "string") {
		return payload.senderDisplayName || "Someone";
	}
	return "Someone";
}
