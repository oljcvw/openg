import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, settings, toastErrorMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	settings: { logErrorsToLogcat: false },
	toastErrorMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: invokeMock,
	isTauri: () => true,
}));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => settings,
}));
vi.mock("svelte-sonner", () => ({ toast: { error: toastErrorMock } }));

import {
	observeBackgroundTask,
	registerGlobalErrorReporting,
	reportClientDiagnostic,
} from "./client-diagnostics";

describe("client diagnostics logcat preference", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(undefined);
		toastErrorMock.mockReset();
		settings.logErrorsToLogcat = false;
	});

	it("records but does not present an empty promise rejection", () => {
		settings.logErrorsToLogcat = true;
		const release = registerGlobalErrorReporting();
		const event = new Event("unhandledrejection");
		Object.defineProperty(event, "reason", { value: undefined });

		window.dispatchEvent(event);
		release();

		expect(invokeMock).toHaveBeenCalledWith("report_client_diagnostic", {
			diagnostic: {
				category: "unexpected_error",
				component: "unhandled_rejection",
				code: "empty_rejection",
				level: "warning",
			},
		});
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("records but does not present an opaque framework rejection", () => {
		settings.logErrorsToLogcat = true;
		const release = registerGlobalErrorReporting();
		const event = new Event("unhandledrejection");
		Object.defineProperty(event, "reason", { value: {} });

		window.dispatchEvent(event);
		release();

		expect(invokeMock).toHaveBeenCalledWith("report_client_diagnostic", {
			diagnostic: {
				category: "unexpected_error",
				component: "unhandled_rejection",
				code: "opaque_rejection",
				level: "warning",
			},
		});
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("does not send diagnostics while logcat logging is disabled", () => {
		reportClientDiagnostic({
			category: "presented_error",
			component: "test",
			code: "javascript_error",
			level: "error",
		});

		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("forwards diagnostics after logcat logging is enabled", () => {
		settings.logErrorsToLogcat = true;
		const diagnostic = {
			category: "presented_error",
			component: "test",
			code: "javascript_error",
			level: "error" as const,
		};

		reportClientDiagnostic(diagnostic);

		expect(invokeMock).toHaveBeenCalledWith("report_client_diagnostic", {
			diagnostic,
		});
	});

	it("owns rejected background work without presenting it globally", async () => {
		settings.logErrorsToLogcat = true;

		observeBackgroundTask(Promise.reject(new Error("private detail")), {
			category: "background_task",
			component: "chat",
			code: "initial_scroll_restore_failed",
		});
		await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());

		expect(invokeMock).toHaveBeenCalledWith("report_client_diagnostic", {
			diagnostic: {
				category: "background_task",
				component: "chat",
				code: "initial_scroll_restore_failed",
				level: "warning",
			},
		});
		expect(toastErrorMock).not.toHaveBeenCalled();
	});
});
