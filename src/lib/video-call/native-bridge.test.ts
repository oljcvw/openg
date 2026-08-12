import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	addPluginListenerMock,
	getDeveloperSettingsSnapshotMock,
	invokeMock,
	unregisterMock,
} = vi.hoisted(() => ({
	addPluginListenerMock: vi.fn(),
	getDeveloperSettingsSnapshotMock: vi.fn(),
	invokeMock: vi.fn(),
	unregisterMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	addPluginListener: addPluginListenerMock,
	invoke: invokeMock,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: getDeveloperSettingsSnapshotMock,
}));

import { nativeVideoCallBridge } from "$lib/video-call/native-bridge";

describe("native video-call bridge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDeveloperSettingsSnapshotMock.mockReturnValue({
			videoCallQualityPreset: "low",
		});
		addPluginListenerMock.mockResolvedValue({ unregister: unregisterMock });
	});

	it("reports unavailable when the mobile plugin is absent", async () => {
		invokeMock.mockRejectedValue(new Error("plugin missing"));

		await expect(nativeVideoCallBridge.isAvailable()).resolves.toBe(false);
	});

	it("starts the mobile plugin with typed channel and quality arguments", async () => {
		invokeMock.mockResolvedValue(undefined);

		await nativeVideoCallBridge.start({
			channelId: "channel",
			token: "token",
			direction: "incoming",
			connectedLimitSeconds: 60,
		});

		expect(invokeMock).toHaveBeenCalledWith("video_call_start", {
			session: {
				channelId: "channel",
				token: "token",
				quality: "low",
				direction: "incoming",
				connectedLimitSeconds: 60,
			},
		});
	});

	it("subscribes to native remote-user and ended events", async () => {
		const remoteHandler = vi.fn();
		const endedHandler = vi.fn();

		const unlistenRemote =
			await nativeVideoCallBridge.onRemoteParticipantJoined(remoteHandler);
		const unlistenEnded = await nativeVideoCallBridge.onEnded(endedHandler);
		addPluginListenerMock.mock.calls[0]![2]({ uid: 9 });
		addPluginListenerMock.mock.calls[1]![2]({ reason: "ended" });
		unlistenRemote();
		unlistenEnded();

		expect(addPluginListenerMock).toHaveBeenNthCalledWith(
			1,
			"open-grind-video-call",
			"remote-user-joined",
			expect.any(Function),
		);
		expect(addPluginListenerMock).toHaveBeenNthCalledWith(
			2,
			"open-grind-video-call",
			"ended",
			expect.any(Function),
		);
		expect(remoteHandler).toHaveBeenCalledOnce();
		expect(endedHandler).toHaveBeenCalledOnce();
		expect(unregisterMock).toHaveBeenCalledTimes(2);
	});
});
