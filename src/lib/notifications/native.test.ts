import { describe, expect, it, vi } from "vitest";
import {
	createNotificationService,
	formatRealtimeNotification,
} from "$lib/notifications/native";

describe("formatRealtimeNotification", () => {
	it("formats Grindr message events for native display", () => {
		expect(
			formatRealtimeNotification({
				type: "chat.v1.message_sent",
				payload: {
					body: { text: "hey there" },
				},
			}),
		).toEqual({
			title: "New message",
			body: "hey there",
		});
	});

	it("formats tap events with the sender display name", () => {
		expect(
			formatRealtimeNotification({
				type: "tap.v1.tap_sent",
				payload: {
					senderDisplayName: "Ada",
				},
			}),
		).toEqual({
			title: "New tap",
			body: "Ada tapped you",
		});
	});

	it("ignores realtime events that should not alert the user", () => {
		expect(
			formatRealtimeNotification({ type: "chat.v1.typing.start" }),
		).toBeUndefined();
	});
});

describe("createNotificationService", () => {
	it("sends notifications when permission is already granted", async () => {
		const sendNotification = vi.fn();
		const requestPermission = vi.fn();
		const service = createNotificationService({
			isPermissionGranted: async () => true,
			requestPermission,
			sendNotification,
		});

		await service.notify({
			type: "viewed_me.v1.new_view_received",
			payload: {},
		});

		expect(requestPermission).not.toHaveBeenCalled();
		expect(sendNotification).toHaveBeenCalledWith({
			title: "New profile view",
			body: "Someone viewed your profile",
		});
	});

	it("does not send notifications when permission is denied", async () => {
		const sendNotification = vi.fn();
		const service = createNotificationService({
			isPermissionGranted: async () => false,
			requestPermission: async () => "denied",
			sendNotification,
		});

		await service.notify({
			type: "chat.v1.message_sent",
			payload: { body: { text: "hey" } },
		});

		expect(sendNotification).not.toHaveBeenCalled();
	});
});
