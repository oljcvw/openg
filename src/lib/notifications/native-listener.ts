import { addPluginListener } from "@tauri-apps/api/core";

import { callMethod } from "$lib/api";
import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import { isIosPlatform } from "$lib/platform/os";
import { acceptedNativeNotificationRoute } from "./native-route";

export type NotificationNavigation = (route: string) => void | Promise<void>;

export function installIosNotificationRouteListener(
	navigate: NotificationNavigation,
): () => void {
	if (!isIosPlatform()) return () => {};
	let cancelled = false;
	let lastRoute: { key: string; handledAt: number } | null = null;
	const handle = (payload: unknown): void => {
		if (cancelled) return;
		const accepted = acceptedNativeNotificationRoute(
			payload,
			getAccountSessionSnapshot().accountId,
		);
		if (!accepted) return;
		const key = `${accepted.accountId}:${accepted.route}`;
		const now = Date.now();
		if (lastRoute?.key === key && now - lastRoute.handledAt < 2_000) return;
		lastRoute = { key, handledAt: now };
		void Promise.resolve()
			.then(() => navigate(accepted.route))
			.catch(() => console.error("Failed to navigate notification route"));
	};
	const registration = addPluginListener(
		"open-grind-notifications",
		"notification-route",
		handle,
	)
		.then(async (listener) => {
			if (cancelled) {
				await listener.unregister();
				return null;
			}
			try {
				handle(await callMethod("notification_take_route"));
			} catch {
				await listener.unregister().catch(() => undefined);
				console.error("Failed to initialize notification routing");
				return null;
			}
			return listener;
		})
		.catch(() => {
			console.error("Failed to register notification routing");
			return null;
		});
	return () => {
		cancelled = true;
		void registration
			.then((listener) => listener?.unregister())
			.catch(() => undefined);
	};
}
