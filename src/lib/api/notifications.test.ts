import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeNotification, registerFcmPushToken } from "./notifications";
import { fetchRest } from "$lib/api";

vi.mock("$lib/api", () => ({
	fetchRest: vi.fn(),
}));

const mockedFetchRest = vi.mocked(fetchRest);

describe("registerFcmPushToken", () => {
	beforeEach(() => {
		mockedFetchRest.mockResolvedValue({} as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("registers the native push token with Grindr", async () => {
		await registerFcmPushToken("fcm-token");

		expect(mockedFetchRest).toHaveBeenCalledWith("/v3/gcm-push-tokens", {
			method: "POST",
			body: { token: "fcm-token" },
		});
	});
});

describe("acknowledgeNotification", () => {
	beforeEach(() => {
		mockedFetchRest.mockResolvedValue({} as Awaited<ReturnType<typeof fetchRest>>);
	});

	it("acknowledges websocket notifications by id", async () => {
		await acknowledgeNotification({
			notificationId: "6a59b6ad-6d2a-49dd-9d78-e0ad901b8d5d",
			source: "WEBSOCKET",
		});

		expect(mockedFetchRest).toHaveBeenCalledWith(
			"/public/v1/notifications/ack",
			{
				method: "POST",
				body: {
					notificationId: "6a59b6ad-6d2a-49dd-9d78-e0ad901b8d5d",
					source: "WEBSOCKET",
				},
			},
		);
	});
});
