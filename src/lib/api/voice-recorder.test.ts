import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, addPluginListenerMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	addPluginListenerMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
	addPluginListener: addPluginListenerMock,
}));

import {
	getVoicePermissionStatus,
	startVoiceRecording,
	stopVoiceRecording,
} from "$lib/api/voice-recorder";

describe("voice recorder bridge", () => {
	beforeEach(() => invokeMock.mockReset());

	it("maps permission status and recorder commands", async () => {
		invokeMock
			.mockResolvedValueOnce({ status: "granted" })
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({
				status: "ready",
				dataBase64: "AQID",
				contentType: "audio/aac",
				durationMs: 1_500,
			});

		await expect(getVoicePermissionStatus()).resolves.toBe("granted");
		await expect(startVoiceRecording()).resolves.toBeUndefined();
		await expect(stopVoiceRecording()).resolves.toMatchObject({
			status: "ready",
			contentType: "audio/aac",
			durationMs: 1_500,
		});
		expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
			"voice_recorder_permission_status",
			"voice_recorder_start",
			"voice_recorder_stop",
		]);
	});
});
