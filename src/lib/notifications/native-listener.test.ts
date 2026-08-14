import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addListener, callMethod, ios, navigate, unregister } = vi.hoisted(
	() => ({
		addListener: vi.fn(),
		callMethod: vi.fn(),
		ios: { value: false },
		navigate: vi.fn(),
		unregister: vi.fn(),
	}),
);

vi.mock("@tauri-apps/api/core", () => ({ addPluginListener: addListener }));
vi.mock("$lib/api", () => ({ callMethod }));
vi.mock("$lib/api/account-caches", () => ({
	getAccountSessionSnapshot: () => ({ accountId: 42 }),
}));
vi.mock("$lib/platform/os", () => ({ isIosPlatform: () => ios.value }));

import { installIosNotificationRouteListener } from "./native-listener";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => (resolve = next));
	return { promise, resolve };
}

describe("iOS notification route listener", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ios.value = false;
		unregister.mockResolvedValue(undefined);
		addListener.mockResolvedValue({ unregister });
		callMethod.mockResolvedValue(null);
	});

	afterEach(() => vi.restoreAllMocks());

	it("does not register or take a pending route on Android", () => {
		const release = installIosNotificationRouteListener(navigate);
		release();

		expect(addListener).not.toHaveBeenCalled();
		expect(callMethod).not.toHaveBeenCalled();
	});

	it("owns foreground and pending iOS routes with duplicate suppression", async () => {
		ios.value = true;
		callMethod.mockResolvedValue({ route: "/chat/abc", accountId: "42" });
		const release = installIosNotificationRouteListener(navigate);
		try {
			await vi.waitFor(() => expect(callMethod).toHaveBeenCalledOnce());
			addListener.mock.calls[0]![2]({ route: "/chat/abc", accountId: "42" });

			expect(navigate).toHaveBeenCalledOnce();
			expect(navigate).toHaveBeenCalledWith("/chat/abc");
		} finally {
			release();
		}
	});

	it("contains asynchronous navigation failures", async () => {
		ios.value = true;
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		navigate.mockRejectedValueOnce(new Error("navigation failed"));
		const release = installIosNotificationRouteListener(navigate);
		try {
			await vi.waitFor(() => expect(callMethod).toHaveBeenCalledOnce());
			addListener.mock.calls[0]![2]({ route: "/chat/abc", accountId: "42" });

			await vi.waitFor(() =>
				expect(error).toHaveBeenCalledWith(
					"Failed to navigate notification route",
				),
			);
		} finally {
			release();
		}
	});

	it("unregisters a listener that resolves after teardown", async () => {
		ios.value = true;
		const registration = deferred<{ unregister(): Promise<void> }>();
		addListener.mockReturnValue(registration.promise);
		const release = installIosNotificationRouteListener(navigate);

		release();
		registration.resolve({ unregister });
		await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
		expect(callMethod).not.toHaveBeenCalled();
	});
});
