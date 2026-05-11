import { describe, expect, it, vi } from "vitest";
import { bindRealtimeNotifications } from "$lib/notifications/realtime-bridge";
import type { RealtimeEvent } from "$lib/realtime";

describe("bindRealtimeNotifications", () => {
	it("subscribes to notification event types and acknowledges handled events", async () => {
		const handlers = new Map<string, (event: RealtimeEvent) => void>();
		const unsubscribe = vi.fn();
		const notify = vi.fn().mockResolvedValue(true);
		const acknowledge = vi.fn().mockResolvedValue(undefined);
		const client = {
			on: vi.fn((type: string, handler: (event: RealtimeEvent) => void) => {
				handlers.set(type, handler);
				return unsubscribe;
			}),
		};

		const stop = bindRealtimeNotifications({
			client,
			notificationService: { notify },
			acknowledge,
		});

		handlers.get("chat.v1.message_sent")?.({
			type: "chat.v1.message_sent",
			notificationId: "notification-1",
			payload: { body: { text: "hello" } },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(client.on).toHaveBeenCalledWith(
			"chat.v1.message_sent",
			expect.any(Function),
		);
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({ type: "chat.v1.message_sent" }),
		);
		expect(acknowledge).toHaveBeenCalledWith({
			notificationId: "notification-1",
			source: "WEBSOCKET",
		});

		stop();
		expect(unsubscribe).toHaveBeenCalled();
	});

	it("does not acknowledge events that were not displayed", async () => {
		const handlers = new Map<string, (event: RealtimeEvent) => void>();
		const acknowledge = vi.fn();
		const client = {
			on: vi.fn((type: string, handler: (event: RealtimeEvent) => void) => {
				handlers.set(type, handler);
				return vi.fn();
			}),
		};

		bindRealtimeNotifications({
			client,
			notificationService: { notify: vi.fn().mockResolvedValue(false) },
			acknowledge,
		});

		handlers.get("tap.v1.tap_sent")?.({
			type: "tap.v1.tap_sent",
			notificationId: "notification-2",
			payload: { senderDisplayName: "Ada" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(acknowledge).not.toHaveBeenCalled();
	});
});
