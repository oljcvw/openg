import { afterEach, describe, expect, it, vi } from "vitest";

const { gotoMock, reportClientDiagnosticMock, toastErrorMock } = vi.hoisted(
	() => ({
		gotoMock: vi.fn(),
		reportClientDiagnosticMock: vi.fn(),
		toastErrorMock: vi.fn(),
	}),
);

vi.mock("$app/navigation", () => ({ goto: gotoMock }));
vi.mock("svelte-sonner", () => ({ toast: { error: toastErrorMock } }));
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportClientDiagnostic: reportClientDiagnosticMock,
}));

import {
	activateAccountSession,
	getAccountSessionSnapshot,
} from "$lib/api/account-caches";
import { getRuntimeOwnershipSnapshot } from "$lib/dev/runtime-ownership";
import {
	backLayerManager,
	dispatchApplicationBack,
	getCurrentNavigationCoordinator,
	installCurrentNavigationCoordinator,
	setSemanticRouteBackHandler,
} from "$lib/navigation/app-navigation";
import * as appNavigation from "$lib/navigation/app-navigation";
import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";
import type {
	AppNavigationStateV1,
	DetailNavigationOptions,
	NavigationEffects,
	NavigationTransitionOutcome,
	RootSurface,
} from "$lib/navigation/navigation-foundations";

async function committed(
	transition: Promise<NavigationTransitionOutcome>,
): Promise<AppNavigationStateV1> {
	const outcome = await transition;
	expect(outcome.kind).toBe("committed");
	if (outcome.kind !== "committed")
		throw new Error("expected committed navigation transition");
	return outcome.state;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

interface NavigationActionApi {
	activateAppRoot: (root: RootSurface) => Promise<void>;
	activateAppRootRoute: (route: string) => Promise<void>;
	closeAppDetail: (route: string, pageState: unknown) => Promise<void>;
	interceptAppNavigationClick: (
		event: MouseEvent,
		navigate: () => void | Promise<unknown>,
	) => Promise<void>;
	openAppDetail: (
		route: string,
		options?: DetailNavigationOptions,
	) => Promise<NavigationTransitionOutcome | null>;
	openInboxConversationDetail: (
		route: string,
	) => Promise<NavigationTransitionOutcome | null>;
	openReceivedAlbumDetail: (
		route: string,
	) => Promise<NavigationTransitionOutcome | null>;
	replaceAppDetail: (
		route: string,
		options?: DetailNavigationOptions,
	) => Promise<NavigationTransitionOutcome | null>;
	registerRootActivationRefresh: (
		route: string,
		refresh: () => void | Promise<void>,
	) => () => void;
}

function navigationActions(): NavigationActionApi {
	return appNavigation;
}

describe("application Back compatibility", () => {
	afterEach(() => {
		backGestureEventHandlers.clear();
		expect(backLayerManager.size).toBe(0);
	});

	it("uses one typed layer while newer true continues to older false", async () => {
		const semanticBack = vi.fn(() => "handled" as const);
		const releaseSemanticBack = setSemanticRouteBackHandler(semanticBack);
		const order: string[] = [];
		const older = vi.fn(() => {
			order.push("older");
			return false;
		});
		const newer = vi.fn(() => {
			order.push("newer");
			return true;
		});
		backGestureEventHandlers.add(older).add(newer);
		expect(backGestureEventHandlers.size).toBe(2);
		expect(backLayerManager.size).toBe(1);
		await expect(dispatchApplicationBack()).resolves.toEqual({
			selected: true,
			result: "handled",
		});
		expect(order).toEqual(["newer", "older"]);
		expect(semanticBack).not.toHaveBeenCalled();

		expect(backGestureEventHandlers.delete(newer)).toBe(true);
		expect(backLayerManager.size).toBe(1);
		expect(backGestureEventHandlers.delete(older)).toBe(true);
		expect(backLayerManager.size).toBe(0);
		releaseSemanticBack();
	});

	it("returns unhandled when every legacy handler continues", async () => {
		const older = vi.fn(() => true);
		const newer = vi.fn(() => true);
		backGestureEventHandlers.add(older).add(newer);

		await expect(dispatchApplicationBack()).resolves.toEqual({
			selected: true,
			result: "unhandled",
		});
		expect(newer).toHaveBeenCalledOnce();
		expect(older).toHaveBeenCalledOnce();
	});

	it("deduplicates and releases its single adapter registration", () => {
		const handler = vi.fn(() => false);
		backGestureEventHandlers.add(handler).add(handler);
		expect(backGestureEventHandlers.size).toBe(1);
		expect(backLayerManager.size).toBe(1);
		expect(backGestureEventHandlers.delete(handler)).toBe(true);
		expect(backGestureEventHandlers.delete(handler)).toBe(false);
		expect(backLayerManager.size).toBe(0);

		backGestureEventHandlers.add(handler);
		expect(backLayerManager.size).toBe(1);
		backGestureEventHandlers.clear();
		expect(backLayerManager.size).toBe(0);
	});

	it("does not log rejected handler values", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const release = backLayerManager.register({
			priority: "localMode",
			handler: async () => Promise.reject(new Error("private-value")),
		});

		await expect(dispatchApplicationBack()).resolves.toEqual({
			selected: true,
			result: "unhandled",
		});
		expect(error).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		release();
		error.mockRestore();
		warn.mockRestore();
	});
});

describe("current account navigation runtime", () => {
	it("plateaus through 100 installed runtimes, route syncs, semantic backs, and account invalidations", async () => {
		const baseline = getRuntimeOwnershipSnapshot();
		for (let index = 0; index < 100; index += 1) {
			const session = activateAccountSession(50_000 + index);
			const runtime = installCurrentNavigationCoordinator({
				accountGeneration: session.generation,
				createEntryId: () => `plateau-${index}`,
				effects: {
					goto: vi.fn(),
					pop: vi.fn(),
					replaceState: vi.fn(),
				},
			});
			await runtime.synchronize("/", {});
			const releaseBack = setSemanticRouteBackHandler(() => "handled");
			await expect(dispatchApplicationBack()).resolves.toEqual({
				selected: false,
				result: "handled",
			});
			releaseBack();
			runtime.release();
		}
		expect(backLayerManager.size).toBe(0);
		expect(getCurrentNavigationCoordinator()).toBeNull();
		expect(getRuntimeOwnershipSnapshot()).toEqual(baseline);
	});

	it("replaces the exposed coordinator and prevents stale writes", async () => {
		const firstSession = activateAccountSession(41_001);
		const firstEffects = {
			goto: vi.fn(),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const first = installCurrentNavigationCoordinator({
			accountGeneration: firstSession.generation,
			createEntryId: () => "first-entry",
			effects: firstEffects,
		});
		expect(getCurrentNavigationCoordinator()).toBe(first.coordinator);

		const secondSession = activateAccountSession(41_002);
		const secondEffects = {
			goto: vi.fn(),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const second = installCurrentNavigationCoordinator({
			accountGeneration: secondSession.generation,
			createEntryId: () => "second-entry",
			effects: secondEffects,
		});

		await expect(first.synchronize("/chat/private-id", {})).rejects.toThrow(
			"stale navigation coordinator",
		);
		expect(firstEffects.replaceState).not.toHaveBeenCalled();
		expect(getCurrentNavigationCoordinator()).toBe(second.coordinator);
		first.release();
		expect(getCurrentNavigationCoordinator()).toBe(second.coordinator);
		second.release();
		expect(getCurrentNavigationCoordinator()).toBeNull();
	});

	it("stamps later unowned route state and preserves a valid ledger", async () => {
		const generation = getAccountSessionSnapshot().generation;
		let entry = 0;
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: generation,
			createEntryId: () => `runtime-${++entry}`,
			effects,
		});

		await runtime.synchronize("/", {});
		await runtime.synchronize("/settings/account/private-page", {
			legacy: "private-value",
		});
		expect(effects.replaceState).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(effects.replaceState.mock.calls)).not.toContain(
			"private-",
		);

		const chat = await committed(
			runtime.coordinator.activateRootRoute("/chat"),
		);
		const detail = await committed(
			runtime.coordinator.openDetail("/chat/private-id"),
		);
		await runtime.synchronize("/chat/private-id", detail);
		const closing = runtime.coordinator.closeDetail("/chat/private-id", detail);
		await runtime.synchronize("/chat", chat);
		await closing;
		expect(effects.pop).toHaveBeenCalledOnce();
		runtime.release();
	});
});

describe("canonical application navigation actions", () => {
	afterEach(() => {
		gotoMock.mockReset();
		reportClientDiagnosticMock.mockReset();
		toastErrorMock.mockReset();
	});

	it("fails closed to replacement roots, siblings, details, and semantic parents without a coordinator", async () => {
		const actions = navigationActions();
		expect(actions.activateAppRoot).toBeTypeOf("function");
		expect(actions.activateAppRootRoute).toBeTypeOf("function");
		expect(actions.openAppDetail).toBeTypeOf("function");
		expect(actions.closeAppDetail).toBeTypeOf("function");

		await actions.activateAppRoot("interest");
		await actions.activateAppRootRoute("/interest/views");
		await actions.openAppDetail("/chat/private-conversation-id");
		await actions.closeAppDetail("/settings/account/privacy", null);

		expect(gotoMock.mock.calls).toEqual([
			["/interest/taps", { replaceState: true }],
			["/interest/views", { replaceState: true }],
			["/chat/private-conversation-id", { replaceState: true }],
			["/settings/account", { replaceState: true }],
		]);
	});

	it("contains and presents a rejected fallback detail Back", async () => {
		const actions = navigationActions();
		gotoMock.mockRejectedValueOnce(new Error("private fallback failure"));

		await expect(
			actions.closeAppDetail("/chat/private-conversation-id", null),
		).resolves.toBeUndefined();

		expect(reportClientDiagnosticMock).toHaveBeenCalledExactlyOnceWith({
			category: "navigation",
			component: "detail",
			code: "detail_transition_failed",
			level: "warning",
		});
		expect(toastErrorMock).toHaveBeenCalledOnce();
		expect(
			JSON.stringify([
				reportClientDiagnosticMock.mock.calls,
				toastErrorMock.mock.calls,
			]),
		).not.toContain("private-");
	});

	it("contains and presents rejected absent-runtime navigation actions", async () => {
		const actions = navigationActions();
		const attempts: Array<{
			component: "root" | "detail";
			run: () => Promise<unknown>;
		}> = [
			{ component: "root", run: () => actions.activateAppRoot("interest") },
			{
				component: "root",
				run: () => actions.activateAppRootRoute("/interest/views"),
			},
			{
				component: "detail",
				run: () => actions.openAppDetail("/chat/private-open"),
			},
			{
				component: "detail",
				run: () => actions.replaceAppDetail("/chat/private-replace"),
			},
			{
				component: "detail",
				run: () => actions.openInboxConversationDetail("/chat/private-inbox"),
			},
			{
				component: "detail",
				run: () => actions.openReceivedAlbumDetail("/albums/private-album"),
			},
		];

		for (const [index, attempt] of attempts.entries()) {
			gotoMock.mockRejectedValueOnce(
				new Error(`private fallback failure ${index}`),
			);
			await expect(attempt.run()).resolves.not.toThrow();
			expect(reportClientDiagnosticMock).toHaveBeenNthCalledWith(index + 1, {
				category: "navigation",
				component: attempt.component,
				code: `${attempt.component}_transition_failed`,
				level: "warning",
			});
		}

		expect(toastErrorMock).toHaveBeenCalledTimes(attempts.length);
		expect(
			JSON.stringify([
				reportClientDiagnosticMock.mock.calls,
				toastErrorMock.mock.calls,
			]),
		).not.toContain("private fallback failure");
	});

	it("intercepts only an ordinary primary link activation", async () => {
		const actions = navigationActions();
		expect(actions.interceptAppNavigationClick).toBeTypeOf("function");
		const navigate = vi.fn();
		const link = document.createElement("a");
		link.href = "/chat";
		const preventOrdinary = vi.fn();
		await actions.interceptAppNavigationClick(
			{
				altKey: false,
				button: 0,
				ctrlKey: false,
				currentTarget: link,
				defaultPrevented: false,
				metaKey: false,
				preventDefault: preventOrdinary,
				shiftKey: false,
			} as unknown as MouseEvent,
			navigate,
		);
		expect(preventOrdinary).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledOnce();

		const preventModified = vi.fn();
		await actions.interceptAppNavigationClick(
			{
				altKey: false,
				button: 0,
				ctrlKey: false,
				currentTarget: link,
				defaultPrevented: false,
				metaKey: true,
				preventDefault: preventModified,
				shiftKey: false,
			} as unknown as MouseEvent,
			navigate,
		);
		expect(preventModified).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledOnce();
	});

	it("owns a rejected intercepted navigation so it cannot escape globally", async () => {
		const actions = navigationActions();
		const link = document.createElement("a");
		link.href = "/chat/conversation";
		const preventDefault = vi.fn();
		const event = {
			altKey: false,
			button: 0,
			ctrlKey: false,
			currentTarget: link,
			defaultPrevented: false,
			metaKey: false,
			preventDefault,
			shiftKey: false,
		} as unknown as MouseEvent;

		await expect(
			actions.interceptAppNavigationClick(event, () =>
				Promise.reject(new Error("private navigation detail")),
			),
		).resolves.toBeUndefined();
		expect(preventDefault).toHaveBeenCalledOnce();
	});

	it("waits for initial root ownership before opening a detail", async () => {
		const actions = navigationActions();
		const session = activateAccountSession(41_999);
		const initialization = deferred<void>();
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(() => initialization.promise),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: (() => {
				let index = 0;
				return () => `initial-${++index}`;
			})(),
			effects,
		});

		const synchronizing = runtime.synchronize("/right-now", {});
		const opening = actions.openAppDetail("/profile/profile-a");
		await Promise.resolve();
		expect(effects.goto).not.toHaveBeenCalled();

		initialization.resolve();
		await synchronizing;
		await expect(opening).resolves.toMatchObject({
			kind: "committed",
			state: {
				root: "rightNow",
				safeReturnRoute: "/right-now",
			},
		});
		expect(effects.goto).toHaveBeenCalledWith(
			"/profile/profile-a",
			expect.objectContaining({ replaceState: false }),
		);
		runtime.release();
	});

	it("waits for the current account runtime before opening a detail", async () => {
		const actions = navigationActions();
		const firstSession = activateAccountSession(42_010);
		const firstEffects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const first = installCurrentNavigationCoordinator({
			accountGeneration: firstSession.generation,
			createEntryId: () => "account-a",
			effects: firstEffects,
		});
		await first.synchronize("/chat", {});

		const secondSession = activateAccountSession(42_011);
		const opening = actions.openAppDetail("/chat/account-b-conversation");
		await Promise.resolve();
		expect(firstEffects.goto).not.toHaveBeenCalled();

		const secondEffects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const second = installCurrentNavigationCoordinator({
			accountGeneration: secondSession.generation,
			createEntryId: (() => {
				let index = 0;
				return () => `account-b-${++index}`;
			})(),
			effects: secondEffects,
		});
		await second.synchronize("/chat", {});

		await expect(opening).resolves.toMatchObject({
			kind: "committed",
			state: { accountGeneration: secondSession.generation, root: "inbox" },
		});
		expect(firstEffects.goto).not.toHaveBeenCalled();
		expect(secondEffects.goto).toHaveBeenCalledExactlyOnceWith(
			"/chat/account-b-conversation",
			expect.objectContaining({ replaceState: false }),
		);
		first.release();
		second.release();
	});

	it("presents a bounded retryable error for a failed detail transition", async () => {
		const actions = navigationActions();
		const session = activateAccountSession(42_000);
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: (() => {
				let index = 0;
				return () => `failure-${++index}`;
			})(),
			effects,
		});
		await runtime.coordinator.activateRootRoute("/chat");
		effects.goto.mockRejectedValueOnce(new Error("private route failure"));

		await expect(
			actions.openAppDetail("/chat/private-conversation-id"),
		).resolves.toEqual({ kind: "failed", reason: "navigationError" });
		expect(reportClientDiagnosticMock).toHaveBeenCalledWith({
			category: "navigation",
			component: "detail",
			code: "detail_transition_failed",
			level: "warning",
		});
		expect(toastErrorMock).toHaveBeenCalledOnce();
		const [, toastOptions] = toastErrorMock.mock.calls[0] ?? [];
		expect(toastOptions).toEqual(
			expect.objectContaining({
				action: expect.objectContaining({ onClick: expect.any(Function) }),
			}),
		);
		expect(JSON.stringify(reportClientDiagnosticMock.mock.calls)).not.toContain(
			"private-",
		);
		runtime.release();
	});

	it("presents a bounded retryable error while consuming a failed detail Back", async () => {
		const actions = navigationActions();
		const session = activateAccountSession(42_000);
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: (() => {
				let index = 0;
				return () => `back-failure-${++index}`;
			})(),
			effects,
		});
		await runtime.coordinator.activateRootRoute("/chat");
		const detail = await committed(
			runtime.coordinator.openDetail("/chat/private-conversation-id"),
		);
		effects.pop.mockRejectedValueOnce(new Error("private pop failure"));
		reportClientDiagnosticMock.mockClear();
		toastErrorMock.mockClear();

		await expect(
			actions.closeAppDetail("/chat/private-conversation-id", detail),
		).resolves.toBeUndefined();

		expect(runtime.coordinator.currentState).toEqual(detail);
		expect(reportClientDiagnosticMock).toHaveBeenCalledExactlyOnceWith({
			category: "navigation",
			component: "detail",
			code: "detail_transition_failed",
			level: "warning",
		});
		expect(toastErrorMock).toHaveBeenCalledOnce();
		const [, toastOptions] = toastErrorMock.mock.calls[0] ?? [];
		expect(toastOptions).toEqual(
			expect.objectContaining({
				action: expect.objectContaining({ onClick: expect.any(Function) }),
			}),
		);
		expect(
			JSON.stringify([
				reportClientDiagnosticMock.mock.calls,
				toastErrorMock.mock.calls,
			]),
		).not.toContain("private-");
		runtime.release();
	});

	it("pushes the first chat or profile and replaces the serial sibling detail", async () => {
		const actions = navigationActions();
		expect(actions.openAppDetail).toBeTypeOf("function");
		const session = activateAccountSession(42_001);
		let entry = 0;
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: () => `serial-${++entry}`,
			effects,
		});

		await runtime.coordinator.activateRootRoute("/chat");
		effects.goto.mockClear();
		await actions.openAppDetail("/chat/conversation-a");
		await actions.openAppDetail("/chat/conversation-b");
		expect(
			effects.goto.mock.calls.map(([, options]) => options.replaceState),
		).toEqual([false, true]);

		await runtime.coordinator.activateRootRoute("/");
		effects.goto.mockClear();
		await actions.openAppDetail("/profile/profile-a");
		await actions.replaceAppDetail("/profile/profile-b");
		expect(
			effects.goto.mock.calls.map(([, options]) => options.replaceState),
		).toEqual([false, true]);
		runtime.release();
	});

	it("closes an active detail tab without refresh and single-flights active-base refresh", async () => {
		const actions = navigationActions();
		expect(actions.activateAppRoot).toBeTypeOf("function");
		expect(actions.registerRootActivationRefresh).toBeTypeOf("function");
		const session = activateAccountSession(42_002);
		let entry = 0;
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: () => `activation-${++entry}`,
			effects,
		});
		const refresh = vi.fn(async () => {});
		const events: Event[] = [];
		const onActivation = (event: Event) => events.push(event);
		window.addEventListener("open-grind:root-activation", onActivation);
		const releaseRefresh = actions.registerRootActivationRefresh(
			"/chat",
			refresh,
		);

		await runtime.coordinator.activateRootRoute("/chat");
		await runtime.coordinator.openDetail("/chat/conversation-a");
		effects.goto.mockClear();
		await actions.activateAppRoot("inbox");
		expect(effects.goto).toHaveBeenCalledWith(
			"/chat",
			expect.objectContaining({ replaceState: true }),
		);
		expect(refresh).not.toHaveBeenCalled();
		expect(events).toHaveLength(0);

		effects.goto.mockClear();
		await Promise.all([
			actions.activateAppRoot("inbox"),
			actions.activateAppRoot("inbox"),
		]);
		expect(effects.goto).not.toHaveBeenCalled();
		expect(refresh).toHaveBeenCalledOnce();
		expect(events).toHaveLength(1);
		expect(events[0]).toBeInstanceOf(CustomEvent);
		expect((events[0] as CustomEvent).detail).toEqual({
			root: "inbox",
			route: "/chat",
		});

		releaseRefresh();
		window.removeEventListener("open-grind:root-activation", onActivation);
		runtime.release();
	});

	it("uses current conversation proof for a received album and otherwise falls back to Albums", async () => {
		const actions = navigationActions();
		expect(actions.openReceivedAlbumDetail).toBeTypeOf("function");
		const session = activateAccountSession(42_003);
		let entry = 0;
		const effects = {
			goto: vi.fn<NavigationEffects["goto"]>(async () => {}),
			pop: vi.fn(),
			replaceState: vi.fn(),
		};
		const runtime = installCurrentNavigationCoordinator({
			accountGeneration: session.generation,
			createEntryId: () => `album-${++entry}`,
			effects,
		});
		await runtime.coordinator.activateRootRoute("/chat");
		await runtime.coordinator.openDetail("/chat/conversation-a");
		const received = await actions.openReceivedAlbumDetail(
			"/albums/received-album?owner=profile-a",
		);
		expect(received).toMatchObject({
			kind: "committed",
			state: {
				parentProof: "validatedReceivedAlbumConversation",
				safeReturnRoute: "/chat",
			},
		});

		await runtime.coordinator.activateRootRoute("/");
		const unowned = await actions.openReceivedAlbumDetail(
			"/albums/unowned-album?owner=profile-b",
		);
		expect(unowned).toMatchObject({
			kind: "committed",
			state: {
				parentEntryId: null,
				safeReturnRoute: "/albums",
			},
		});
		runtime.release();
	});
});
