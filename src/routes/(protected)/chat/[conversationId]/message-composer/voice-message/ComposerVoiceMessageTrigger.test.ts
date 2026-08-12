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
	getVoiceRecorderAvailabilityMock,
	getVoicePermissionStatusMock,
	onVoiceRecordingErrorMock,
	onVoiceRecordingMaxDurationMock,
	observeBackgroundTaskMock,
	reportClientDiagnosticMock,
	startVoiceRecordingMock,
	stopVoiceRecordingMock,
	toastErrorMock,
	uploadChatMediaMock,
} = vi.hoisted(() => ({
	cancelVoiceRecordingMock: vi.fn(),
	getVoiceRecorderAvailabilityMock: vi.fn(),
	getVoicePermissionStatusMock: vi.fn(),
	onVoiceRecordingErrorMock: vi.fn(),
	onVoiceRecordingMaxDurationMock: vi.fn(),
	observeBackgroundTaskMock: vi.fn(
		(task: Promise<unknown>) => void task.catch(() => {}),
	),
	reportClientDiagnosticMock: vi.fn(),
	startVoiceRecordingMock: vi.fn(),
	stopVoiceRecordingMock: vi.fn(),
	toastErrorMock: vi.fn(),
	uploadChatMediaMock: vi.fn(),
}));

vi.mock("$lib/api/messaging/chat-media", () => ({
	uploadChatMedia: uploadChatMediaMock,
}));
vi.mock("$lib/api/voice-recorder", () => ({
	cancelVoiceRecording: cancelVoiceRecordingMock,
	getVoiceRecorderAvailability: getVoiceRecorderAvailabilityMock,
	getVoicePermissionStatus: getVoicePermissionStatusMock,
	onVoiceRecordingError: onVoiceRecordingErrorMock,
	onVoiceRecordingMaxDuration: onVoiceRecordingMaxDurationMock,
	requestVoicePermission: vi.fn(),
	startVoiceRecording: startVoiceRecordingMock,
	stopVoiceRecording: stopVoiceRecordingMock,
}));
vi.mock("$lib/platform/client-diagnostics", () => ({
	observeBackgroundTask: observeBackgroundTaskMock,
	reportClientDiagnostic: reportClientDiagnosticMock,
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
		Element.prototype.animate = vi.fn(() => ({
			cancel: vi.fn(),
			finished: Promise.resolve(),
		})) as unknown as typeof Element.prototype.animate;
		getVoiceRecorderAvailabilityMock.mockResolvedValue({
			available: true,
			reason: null,
		});
		getVoicePermissionStatusMock.mockResolvedValue("granted");
		startVoiceRecordingMock.mockResolvedValue(undefined);
		stopVoiceRecordingMock.mockResolvedValue({ status: "tooShort" });
		cancelVoiceRecordingMock.mockResolvedValue(undefined);
		onVoiceRecordingErrorMock.mockResolvedValue({
			unregister: vi.fn().mockResolvedValue(undefined),
		});
		onVoiceRecordingMaxDurationMock.mockResolvedValue({
			unregister: vi.fn().mockResolvedValue(undefined),
		});
		uploadChatMediaMock.mockResolvedValue({
			mediaId: 40,
			mediaHash: "hash",
			url: "https://cdns.grindr.com/audio",
		});
	});

	afterEach(cleanup);

	it("toggles recording with Space and exposes switch state", async () => {
		render(Harness, { sendMessage: vi.fn() });
		const control = await screen.findByRole("switch", {
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
		const control = await screen.findByRole("switch");

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
		const control = await screen.findByRole("switch");

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
		await waitFor(() =>
			expect(onVoiceRecordingMaxDurationMock).toHaveBeenCalledOnce(),
		);

		view.unmount();
		registration.resolve({ unregister });

		await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
	});

	it("owns listener registration failures and disables only voice messaging", async () => {
		const unregister = vi.fn().mockResolvedValue(undefined);
		onVoiceRecordingMaxDurationMock.mockResolvedValue({ unregister });
		onVoiceRecordingErrorMock.mockRejectedValue(
			new Error("listener permission denied"),
		);
		render(Harness, { sendMessage: vi.fn() });

		await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(
				screen.getByRole("switch", { name: "Voice messages unavailable" }),
			).toHaveProperty("disabled", true),
		);
		expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
			category: "listener_error",
			component: "voice_recorder",
			code: "registration_failed",
			level: "error",
		});
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Voice messages unavailable",
			expect.objectContaining({ id: "voice-recorder-listener-error" }),
		);

		render(Harness, { sendMessage: vi.fn() });
		await waitFor(() =>
			expect(reportClientDiagnosticMock).toHaveBeenCalledTimes(2),
		);
		expect(toastErrorMock).toHaveBeenCalledTimes(1);
	});

	it("reports rejected partial cleanup without leaking the native error", async () => {
		onVoiceRecordingMaxDurationMock.mockResolvedValue({
			unregister: vi.fn().mockRejectedValue(new Error("private native detail")),
		});
		onVoiceRecordingErrorMock.mockRejectedValue(
			new Error("registration failed"),
		);
		render(Harness, { sendMessage: vi.fn() });

		await waitFor(() =>
			expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
				category: "listener_error",
				component: "voice_recorder",
				code: "listener_cleanup_failed",
				level: "warning",
			}),
		);
		expect(reportClientDiagnosticMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.anything() }),
		);
	});

	it("owns rejected listener cleanup during teardown", async () => {
		const unregister = vi.fn().mockRejectedValue(new Error("cleanup failed"));
		onVoiceRecordingMaxDurationMock.mockResolvedValue({ unregister });
		const view = render(Harness, { sendMessage: vi.fn() });
		await waitFor(() =>
			expect(onVoiceRecordingErrorMock).toHaveBeenCalledOnce(),
		);
		const registrationTask = observeBackgroundTaskMock.mock.calls[0]?.[0];
		expect(registrationTask).toBeInstanceOf(Promise);
		await registrationTask;

		view.unmount();

		expect(observeBackgroundTaskMock).toHaveBeenCalledWith(
			expect.any(Promise),
			{
				category: "listener_error",
				component: "voice_recorder",
				code: "listener_cleanup_failed",
				level: "warning",
			},
		);
	});

	it("hides recording when the native capability is unavailable", async () => {
		getVoiceRecorderAvailabilityMock.mockResolvedValue({
			available: false,
			reason: "unsupported-platform",
		});
		render(Harness, { sendMessage: vi.fn() });

		await waitFor(() =>
			expect(getVoiceRecorderAvailabilityMock).toHaveBeenCalledOnce(),
		);
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
		const control = await screen.findByRole("switch");

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
