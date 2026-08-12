import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callMethodMock, connectedHandlers, droppedHandlers, serverHandlers } =
	vi.hoisted(() => ({
		callMethodMock: vi.fn(() => Promise.resolve(1)),
		connectedHandlers: [] as (() => void)[],
		droppedHandlers: [] as ((skipped: number) => void)[],
		serverHandlers: new Map<string, (event: unknown) => void>(),
	}));

vi.mock("$lib/api", () => ({ callMethod: callMethodMock }));
vi.mock("$lib/app-data/preferences.svelte", () => ({
	getDeveloperSettingsSnapshot: () => ({ reconcileThrottleMs: 2_000 }),
}));
vi.mock("$lib/ws.svelte", () => ({
	chatV1CacheBombInboxEventSchema: {},
	chatV1ConversationUpdateEventSchema: {},
	chatV1MessageDeletedEventSchema: {},
	chatV1RefreshDynamicEventSchema: {},
	ws: {
		onConnected(handler: () => void) {
			connectedHandlers.push(handler);
			return Promise.resolve(vi.fn());
		},
		onEventsDropped(handler: (skipped: number) => void) {
			droppedHandlers.push(handler);
			return Promise.resolve(vi.fn());
		},
		on(eventType: string, _schema: unknown, handler: (event: unknown) => void) {
			serverHandlers.set(eventType, handler);
			return Promise.resolve(vi.fn());
		},
	},
}));

async function freshReconciler() {
	connectedHandlers.length = 0;
	droppedHandlers.length = 0;
	serverHandlers.clear();
	vi.resetModules();
	const { reconciler } = await import("./reconcile");
	// The constructor subscribes through promise-returning mocks.
	await vi.advanceTimersByTimeAsync(0);
	return reconciler;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});
	return { promise, resolve };
}

describe("Reconciler resync after dropped websocket events", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reconciles immediately when no reconcile is in the throttle window", async () => {
		const reconciler = await freshReconciler();
		const handler = vi.fn();
		reconciler.subscribe("inbox", handler);

		droppedHandlers[0]!(3);
		await vi.advanceTimersByTimeAsync(0);

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("defers a resync that lands inside the throttle window instead of dropping it", async () => {
		const reconciler = await freshReconciler();
		const handler = vi.fn();
		reconciler.subscribe("inbox", handler);

		droppedHandlers[0]!(3);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1200);
		droppedHandlers[0]!(7);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(800);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("coalesces a burst of drops into a single resync", async () => {
		const reconciler = await freshReconciler();
		const handler = vi.fn();
		reconciler.subscribe("inbox", handler);

		droppedHandlers[0]!(3);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		droppedHandlers[0]!(256);
		droppedHandlers[0]!(256);
		droppedHandlers[0]!(256);

		await vi.advanceTimersByTimeAsync(2000);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("coalesces reconnect and drop reasons inside the throttle window", async () => {
		const reconciler = await freshReconciler();
		const handler = vi.fn();
		reconciler.subscribe("inbox", handler);

		droppedHandlers[0]!(3);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1200);
		droppedHandlers[0]!(7);

		connectedHandlers[0]!();
		connectedHandlers[0]!();
		await vi.advanceTimersByTimeAsync(800);
		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler.mock.calls[1]![0].reasons).toEqual(
			new Set(["events-dropped", "reconnected"]),
		);
	});

	it("keeps broad conversation reconciliation broad when targeted work follows", async () => {
		const reconciler = await freshReconciler();
		const handler = vi.fn();
		reconciler.subscribe("conversation", handler);

		reconciler.request("server-signal", ["conversation"], ["initial-id"]);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(1_000);
		reconciler.request("server-signal", ["conversation"]);
		reconciler.request("server-signal", ["conversation"], ["targeted-id"]);
		await vi.advanceTimersByTimeAsync(1_000);

		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler.mock.calls[1]![0]).toMatchObject({
			allConversations: true,
			conversationIds: new Set(),
		});
	});

	it("serializes handlers and preserves work requested during an active pass", async () => {
		const reconciler = await freshReconciler();
		const firstPass = deferred<void>();
		let active = 0;
		let maxActive = 0;
		const handler = vi.fn(async (event: unknown) => {
			void event;
			active += 1;
			maxActive = Math.max(maxActive, active);
			if (handler.mock.calls.length === 1) await firstPass.promise;
			active -= 1;
		});
		reconciler.subscribe("inbox", handler);

		reconciler.request("server-signal", ["inbox"]);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).toHaveBeenCalledOnce();

		reconciler.request("foreground", ["inbox"]);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(handler).toHaveBeenCalledOnce();

		firstPass.resolve();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler.mock.calls[1]?.[0]).toMatchObject({
			reasons: new Set(["foreground"]),
		});
		expect(maxActive).toBe(1);
	});
});
