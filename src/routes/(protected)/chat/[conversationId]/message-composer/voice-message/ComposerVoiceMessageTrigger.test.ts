import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	cancelVoiceRecordingMock,
	getVoicePermissionStatusMock,
	onVoiceRecordingErrorMock,
	onVoiceRecordingMaxDurationMock,
	platformMock,
	startVoiceRecordingMock,
	stopVoiceRecordingMock,
	toastErrorMock,
	uploadChatMediaMock,
} = vi.hoisted(() => ({
	cancelVoiceRecordingMock: vi.fn(),
	getVoicePermissionStatusMock: vi.fn(),
	onVoiceRecordingErrorMock: vi.fn(),
	onVoiceRecordingMaxDurationMock: vi.fn(),
	platformMock: vi.fn(),
	startVoiceRecordingMock: vi.fn(),
	stopVoiceRecordingMock: vi.fn(),
	toastErrorMock: vi.fn(),
	uploadChatMediaMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: platformMock }));
vi.mock("$lib/api/messaging/chat-media", () => ({
	uploadChatMedia: uploadChatMediaMock,
}));
vi.mock("$lib/api/voice-recorder", () => ({
	cancelVoiceRecording: cancelVoiceRecordingMock,
	getVoicePermissionStatus: getVoicePermissionStatusMock,
	onVoiceRecordingError: onVoiceRecordingErrorMock,
	onVoiceRecordingMaxDuration: onVoiceRecordingMaxDurationMock,
	requestVoicePermission: vi.fn(),
	startVoiceRecording: startVoiceRecordingMock,
	stopVoiceRecording: stopVoiceRecordingMock,
}));
vi.mock("svelte-sonner", () => ({
	toast: {
		error: toastErrorMock,
		info: vi.fn(),
		success: vi.fn(),
	},
}));

import Harness from "./ComposerVoiceMessageTrigger.test.svelte";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe("ComposerVoiceMessageTrigger keyboard semantics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		platformMock.mockReturnValue("android");
		getVoicePermissionStatusMock.mockResolvedValue("granted");
		startVoiceRecordingMock.mockResolvedValue(undefined);
		stopVoiceRecordingMock.mockResolvedValue({ status: "tooShort" });
		cancelVoiceRecordingMock.mockResolvedValue(undefined);
		onVoiceRecordingErrorMock.mockResolvedValue({ unregister: vi.fn() });
		onVoiceRecordingMaxDurationMock.mockResolvedValue({ unregister: vi.fn() });
		uploadChatMediaMock.mockResolvedValue({
			mediaId: 40,
			mediaHash: "hash",
			url: "https://cdns.grindr.com/audio",
		});
	});

	afterEach(cleanup);

	it("toggles recording with Space and exposes switch state", async () => {
		render(Harness, { sendMessage: vi.fn() });
		const control = screen.getByRole("switch", {
			name: "Hold to record voice message",
		});
		expect(control.getAttribute("aria-checked")).toBe("false");

		await fireEvent.keyDown(control, { key: " " });
		await waitFor(() => expect(startVoiceRecordingMock).toHaveBeenCalledOnce());
		expect(control.getAttribute("aria-checked")).toBe("true");

		await fireEvent.keyDown(control, { key: " " });
		await waitFor(() => expect(stopVoiceRecordingMock).toHaveBeenCalledOnce());
		expect(control.getAttribute("aria-checked")).toBe("false");
	});

	it("toggles recording with Enter without starting a pointer gesture", async () => {
		render(Harness, { sendMessage: vi.fn() });
		const control = screen.getByRole("switch");

		await fireEvent.keyDown(control, { key: "Enter" });
		await waitFor(() => expect(startVoiceRecordingMock).toHaveBeenCalledOnce());
		await fireEvent.keyDown(control, { key: "Enter" });
		await waitFor(() => expect(stopVoiceRecordingMock).toHaveBeenCalledOnce());

		expect(cancelVoiceRecordingMock).not.toHaveBeenCalled();
	});

	it("starts at most once while permission status is pending", async () => {
		const permission = deferred<string>();
		getVoicePermissionStatusMock.mockReturnValue(permission.promise);
		render(Harness, { sendMessage: vi.fn() });
		const control = screen.getByRole("switch");

		await fireEvent.keyDown(control, { key: "Enter" });
		await fireEvent.keyDown(control, { key: "Enter" });
		permission.resolve("granted");

		await waitFor(() => expect(startVoiceRecordingMock).toHaveBeenCalledOnce());
	});

	it("unregisters a listener that finishes registering after teardown", async () => {
		const registration = deferred<{ unregister(): Promise<void> }>();
		const unregister = vi.fn().mockResolvedValue(undefined);
		onVoiceRecordingMaxDurationMock.mockReturnValue(registration.promise);
		const view = render(Harness, { sendMessage: vi.fn() });

		view.unmount();
		registration.resolve({ unregister });

		await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
	});

	it("defaults safely when the Tauri platform API is unavailable", () => {
		platformMock.mockImplementation(() => {
			throw new Error("Tauri unavailable");
		});
		render(Harness, { sendMessage: vi.fn() });

		expect(screen.queryByRole("switch")).toBeNull();
	});

	it("reuses an uploaded voice payload when message enqueue is retried", async () => {
		const sendMessage = vi
			.fn()
			.mockRejectedValueOnce(new Error("enqueue failed"))
			.mockResolvedValueOnce(undefined);
		stopVoiceRecordingMock.mockResolvedValue({
			status: "ready",
			dataBase64: "AA==",
			contentType: "audio/mp4",
			durationMs: 1_500,
		});
		render(Harness, { sendMessage });
		const control = screen.getByRole("switch");

		await fireEvent.keyDown(control, { key: "Enter" });
		await waitFor(() => expect(startVoiceRecordingMock).toHaveBeenCalledOnce());
		await fireEvent.keyDown(control, { key: "Enter" });
		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 0));
		const retry = toastErrorMock.mock.calls[0]?.[1]?.action?.onClick;
		expect(retry).toBeTypeOf("function");
		retry();

		await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
		expect(uploadChatMediaMock).toHaveBeenCalledOnce();
	});
});
