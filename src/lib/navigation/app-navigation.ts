import { goto } from "$app/navigation";

import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import { runtimeOwnership } from "$lib/dev/runtime-ownership";
import {
	type AppNavigationStateV1,
	type BackHandler,
	BackLayerManager,
	type BackLayerSelection,
	classifyRoute,
	type DetailNavigationOptions,
	NavigationCoordinator,
	type NavigationCoordinatorOptions,
	type RootSurface,
	type SafeReturnRoute,
} from "$lib/navigation/navigation-foundations";

export const backLayerManager = new BackLayerManager();

let semanticRouteBackHandler: BackHandler | null = null;
let currentNavigationRuntime: InternalNavigationRuntime | null = null;

const DEFAULT_ROOT_ROUTE: Record<RootSurface, SafeReturnRoute> = {
	browse: "/",
	rightNow: "/right-now",
	interest: "/interest/taps",
	inbox: "/chat",
	settings: "/settings",
};
const ROOT_ROUTES = new Set<SafeReturnRoute>([
	"/",
	"/right-now",
	"/interest/taps",
	"/interest/views",
	"/chat",
	"/albums",
	"/settings",
]);

export interface RootActivationEventDetail {
	root: RootSurface;
	route: SafeReturnRoute;
}

declare global {
	interface WindowEventMap {
		"open-grind:root-activation": CustomEvent<RootActivationEventDetail>;
	}
}

type RootRefresh = () => void | Promise<void>;

const rootRefreshCallbacks = new Map<SafeReturnRoute, RootRefresh>();
const rootActionFlights = new Map<RootSurface, Promise<void>>();

export interface CurrentNavigationRuntime {
	coordinator: NavigationCoordinator;
	release: () => void;
	synchronize: (route: string, pageState: unknown) => Promise<void>;
}

interface InternalNavigationRuntime extends CurrentNavigationRuntime {
	deactivate: () => void;
}

export function getCurrentNavigationCoordinator(): NavigationCoordinator | null {
	return currentNavigationRuntime?.coordinator ?? null;
}

function pathnameOf(route: string): string {
	try {
		const pathname = new URL(route, "https://open-grind.invalid").pathname;
		return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
	} catch {
		return "";
	}
}

function requireRootRoute(route: string): SafeReturnRoute {
	const pathname = pathnameOf(route) as SafeReturnRoute;
	if (!ROOT_ROUTES.has(pathname))
		throw new TypeError("navigation action requires a canonical root route");
	return pathname;
}

function requireDetailRoute(route: string): void {
	if (classifyRoute(route).level !== "detail")
		throw new TypeError("navigation action requires a detail route");
}

async function safeReplacement(route: string): Promise<void> {
	await goto(route, { replaceState: true });
}

async function activateCurrentRootBase(
	root: RootSurface,
	route: SafeReturnRoute,
): Promise<void> {
	if (typeof window !== "undefined")
		window.dispatchEvent(
			new CustomEvent<RootActivationEventDetail>("open-grind:root-activation", {
				detail: { root, route },
			}),
		);
	await rootRefreshCallbacks.get(route)?.();
}

export function registerRootActivationRefresh(
	route: string,
	refresh: RootRefresh,
): () => void {
	const rootRoute = requireRootRoute(route);
	rootRefreshCallbacks.set(rootRoute, refresh);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (rootRefreshCallbacks.get(rootRoute) === refresh)
			rootRefreshCallbacks.delete(rootRoute);
	};
}

export function activateAppRoot(root: RootSurface): Promise<void> {
	const existing = rootActionFlights.get(root);
	if (existing) return existing;
	const operation = (async () => {
		const coordinator = getCurrentNavigationCoordinator();
		if (!coordinator) {
			await safeReplacement(DEFAULT_ROOT_ROUTE[root]);
			return;
		}
		const current = coordinator.currentState;
		if (current?.root === root && current.level === "root") {
			await activateCurrentRootBase(root, current.safeReturnRoute);
			return;
		}
		await coordinator.activateCurrentRoot(root);
	})().finally(() => {
		if (rootActionFlights.get(root) === operation)
			rootActionFlights.delete(root);
	});
	rootActionFlights.set(root, operation);
	return operation;
}

export async function activateAppRootRoute(route: string): Promise<void> {
	const rootRoute = requireRootRoute(route);
	const coordinator = getCurrentNavigationCoordinator();
	if (coordinator) {
		await coordinator.activateRootRoute(rootRoute);
		return;
	}
	await safeReplacement(rootRoute);
}

export async function openAppDetail(
	route: string,
	options: DetailNavigationOptions = {},
): Promise<AppNavigationStateV1 | null> {
	requireDetailRoute(route);
	const coordinator = getCurrentNavigationCoordinator();
	if (coordinator) return coordinator.openDetail(route, options);
	await safeReplacement(route);
	return null;
}

export async function replaceAppDetail(
	route: string,
	options: DetailNavigationOptions = {},
): Promise<AppNavigationStateV1 | null> {
	requireDetailRoute(route);
	const coordinator = getCurrentNavigationCoordinator();
	if (coordinator) return coordinator.replaceDetail(route, options);
	await safeReplacement(route);
	return null;
}

export async function closeAppDetail(
	route: string,
	pageState: unknown,
): Promise<void> {
	requireDetailRoute(route);
	const coordinator = getCurrentNavigationCoordinator();
	if (coordinator) {
		await coordinator.closeDetail(route, pageState);
		return;
	}
	await safeReplacement(classifyRoute(route).safeReturnRoute);
}

export async function openInboxConversationDetail(
	route: string,
): Promise<AppNavigationStateV1 | null> {
	const classification = classifyRoute(route);
	if (
		classification.level !== "detail" ||
		classification.detailKind !== "conversation"
	)
		throw new TypeError("Inbox conversation action requires a conversation");
	const coordinator = getCurrentNavigationCoordinator();
	if (!coordinator) {
		await safeReplacement(route);
		return null;
	}
	const current = coordinator.currentState;
	if (
		current?.root !== "inbox" ||
		current.surface !== "inboxChats" ||
		current.safeReturnRoute !== "/chat"
	)
		await coordinator.activateRootRoute("/chat");
	return coordinator.openDetail(route);
}

export async function openReceivedAlbumDetail(
	route: string,
): Promise<AppNavigationStateV1 | null> {
	const classification = classifyRoute(route);
	if (
		classification.level !== "detail" ||
		classification.detailKind !== "album"
	)
		throw new TypeError("received album action requires an album detail");
	const coordinator = getCurrentNavigationCoordinator();
	if (!coordinator) {
		await safeReplacement(route);
		return null;
	}
	const receivedAlbumParent =
		coordinator.createReceivedAlbumConversationParentProof();
	return coordinator.openDetail(
		route,
		receivedAlbumParent ? { receivedAlbumParent } : {},
	);
}

export function interceptAppNavigationClick(
	event: MouseEvent,
	navigate: () => void | Promise<unknown>,
): void {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	)
		return;
	const link = event.currentTarget;
	if (
		link instanceof HTMLAnchorElement &&
		(link.target === "_blank" || link.hasAttribute("download"))
	)
		return;
	event.preventDefault();
	void navigate();
}

export function installCurrentNavigationCoordinator({
	accountGeneration,
	createEntryId,
	effects,
}: NavigationCoordinatorOptions): CurrentNavigationRuntime {
	currentNavigationRuntime?.deactivate();
	const releaseOwnership = runtimeOwnership.acquire("navigation-runtime");
	let active = true;
	const assertCurrent = () => {
		if (
			!active ||
			currentNavigationRuntime !== runtime ||
			getAccountSessionSnapshot().generation !== accountGeneration
		)
			throw new Error("stale navigation coordinator");
	};
	const coordinator = new NavigationCoordinator({
		accountGeneration,
		createEntryId,
		effects: {
			goto: (route, options) => {
				assertCurrent();
				return effects.goto(route, options);
			},
			pop: () => {
				assertCurrent();
				return effects.pop();
			},
			replaceState: (route, state) => {
				assertCurrent();
				return effects.replaceState(route, state);
			},
		},
	});
	const deactivate = () => {
		if (!active) return;
		active = false;
		releaseOwnership();
	};
	const release = () => {
		deactivate();
		if (currentNavigationRuntime === runtime) currentNavigationRuntime = null;
	};
	const runtime: InternalNavigationRuntime = {
		coordinator,
		deactivate,
		release,
		async synchronize(route, pageState) {
			assertCurrent();
			await coordinator.initializeCurrentRoute(route, pageState);
		},
	};
	currentNavigationRuntime = runtime;
	return runtime;
}

export function setSemanticRouteBackHandler(handler: BackHandler): () => void {
	semanticRouteBackHandler = handler;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (semanticRouteBackHandler === handler) semanticRouteBackHandler = null;
	};
}

export async function dispatchApplicationBack(): Promise<BackLayerSelection> {
	const layer = await backLayerManager.handleBackSelection();
	if (layer.selected) return layer;

	try {
		return {
			selected: false,
			result: (await semanticRouteBackHandler?.()) ?? "unhandled",
		};
	} catch {
		return { selected: false, result: "unhandled" };
	}
}
