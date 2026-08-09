// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	backLayerManager,
	setSemanticRouteBackHandler,
} from "$lib/navigation/app-navigation";
import {
	applyBackGestureHandler,
	handleAndroidBackEvent,
	registerAndroidBackButtonListener,
} from "$lib/platform/android-native-bridge";
import { backGestureEventHandlers } from "$lib/platform/back-gesture-event.svelte";

const nativePlugin = vi.hoisted(() => ({
	listener: null as (() => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
	addPluginListener: vi.fn(
		(_plugin: string, _event: string, listener: () => void) => {
			nativePlugin.listener = listener;
			return Promise.resolve();
		},
	),
}));

describe("Android native Back bridge", () => {
	afterEach(() => {
		backGestureEventHandlers.clear();
		expect(backLayerManager.size).toBe(0);
		nativePlugin.listener = null;
		delete window.__AndroidOnBackGesture;
		delete window.__AndroidBack;
	});

	it("selects one typed legacy layer while its adapter continues internally", () => {
		const older = vi.fn(() => false);
		const newer = vi.fn(() => true);
		backGestureEventHandlers.add(older);
		backGestureEventHandlers.add(newer);
		applyBackGestureHandler();

		expect(window.__AndroidOnBackGesture?.()).toBe(false);
		expect(backLayerManager.size).toBe(1);
		expect(newer).toHaveBeenCalledOnce();
		expect(older).toHaveBeenCalledOnce();
	});

	it("does not cascade an unhandled layer into route Back in the same event", async () => {
		const moveTaskToBack = vi.fn();
		window.__AndroidBack = { moveTaskToBack };
		const semanticBack = vi.fn(() => "handled" as const);
		const releaseSemanticBack = setSemanticRouteBackHandler(semanticBack);
		const releaseLayer = backLayerManager.register({
			priority: "viewer",
			handler: () => "unhandled",
		});

		await handleAndroidBackEvent();
		expect(semanticBack).not.toHaveBeenCalled();
		expect(moveTaskToBack).not.toHaveBeenCalled();

		releaseLayer();
		await handleAndroidBackEvent();
		expect(semanticBack).toHaveBeenCalledOnce();
		releaseSemanticBack();
	});

	it("backgrounds Browse when semantic route Back is unhandled", async () => {
		const moveTaskToBack = vi.fn();
		window.__AndroidBack = { moveTaskToBack };
		const releaseSemanticBack = setSemanticRouteBackHandler(() => "unhandled");

		await handleAndroidBackEvent();
		expect(moveTaskToBack).toHaveBeenCalledOnce();
		releaseSemanticBack();
	});

	it("uses the typed manager from the plugin listener entry point", async () => {
		const older = vi.fn(() => false);
		const newer = vi.fn(() => true);
		backGestureEventHandlers.add(older);
		backGestureEventHandlers.add(newer);
		await registerAndroidBackButtonListener();

		nativePlugin.listener?.();
		await vi.waitFor(() => expect(newer).toHaveBeenCalledOnce());
		expect(backLayerManager.size).toBe(1);
		expect(older).toHaveBeenCalledOnce();
	});

	it("orders viewer, drawer, then semantic route Back across three events", async () => {
		const order: string[] = [];
		let releaseViewer = () => {};
		let releaseDrawer = () => {};
		releaseDrawer = backLayerManager.register({
			priority: "drawer",
			handler: () => {
				order.push("drawer");
				releaseDrawer();
				return "handled";
			},
		});
		releaseViewer = backLayerManager.register({
			priority: "viewer",
			handler: () => {
				order.push("viewer");
				releaseViewer();
				return "handled";
			},
		});
		const releaseSemanticBack = setSemanticRouteBackHandler(() => {
			order.push("route");
			return "handled";
		});

		await handleAndroidBackEvent();
		await handleAndroidBackEvent();
		await handleAndroidBackEvent();
		expect(order).toEqual(["viewer", "drawer", "route"]);
		releaseSemanticBack();
	});
});
