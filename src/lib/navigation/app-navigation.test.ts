import { afterEach, describe, expect, it, vi } from "vitest";

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));

vi.mock("$app/navigation", () => ({ goto: gotoMock }));

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
	RootSurface,
} from "$lib/navigation/navigation-foundations";

interface NavigationActionApi {
	activateAppRoot: (root: RootSurface) => Promise<void>;
	activateAppRootRoute: (route: string) => Promise<void>;
	closeAppDetail: (route: string, pageState: unknown) => Promise<void>;
	interceptAppNavigationClick: (
		event: MouseEvent,
		navigate: () => void | Promise<unknown>,
	) => void;
	openAppDetail: (
		route: string,
		options?: DetailNavigationOptions,
	) => Promise<AppNavigationStateV1 | null>;
	openReceivedAlbumDetail: (
		route: string,
	) => Promise<AppNavigationStateV1 | null>;
	replaceAppDetail: (
		route: string,
		options?: DetailNavigationOptions,
	) => Promise<AppNavigationStateV1 | null>;
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

		await runtime.coordinator.activateRootRoute("/chat");
		const detail = await runtime.coordinator.openDetail("/chat/private-id");
		await runtime.synchronize("/chat/private-id", detail);
		await runtime.coordinator.closeDetail("/chat/private-id", detail);
		expect(effects.pop).toHaveBeenCalledOnce();
		runtime.release();
	});
});

describe("canonical application navigation actions", () => {
	afterEach(() => {
		gotoMock.mockReset();
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

	it("intercepts only an ordinary primary link activation", () => {
		const actions = navigationActions();
		expect(actions.interceptAppNavigationClick).toBeTypeOf("function");
		const navigate = vi.fn();
		const link = document.createElement("a");
		link.href = "/chat";
		const preventOrdinary = vi.fn();
		actions.interceptAppNavigationClick(
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
		actions.interceptAppNavigationClick(
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
			parentProof: "validatedReceivedAlbumConversation",
			safeReturnRoute: "/chat",
		});

		await runtime.coordinator.activateRootRoute("/");
		const unowned = await actions.openReceivedAlbumDetail(
			"/albums/unowned-album?owner=profile-b",
		);
		expect(unowned).toMatchObject({
			parentEntryId: null,
			safeReturnRoute: "/albums",
		});
		runtime.release();
	});
});
