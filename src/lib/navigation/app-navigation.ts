import { goto } from "$app/navigation";
import { toast } from "svelte-sonner";

import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { runtimeOwnership } from "$lib/dev/runtime-ownership";
import {
	type BackHandler,
	BackLayerManager,
	type BackLayerSelection,
	classifyRoute,
	type DetailNavigationOptions,
	NavigationCoordinator,
	type NavigationCoordinatorOptions,
	type NavigationTransitionOutcome,
	type RootSurface,
	type SafeReturnRoute,
} from "$lib/navigation/navigation-foundations";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";

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

function presentNavigationFailure(
	outcome: NavigationTransitionOutcome,
	component: "root" | "detail",
	retry: () => void | Promise<unknown>,
): void {
	if (outcome.kind !== "failed") return;
	reportClientDiagnostic({
		category: "navigation",
		component,
		code:
			outcome.reason === "timeout"
				? `${component}_transition_timeout`
				: `${component}_transition_failed`,
		level: "warning",
	});
	toast.error("Couldn't change screens", {
		description: "Your current screen was kept. Try again.",
		action: {
			label: "Retry",
			onClick: () => void retry(),
		},
	});
}

export interface CurrentNavigationRuntime {
	coordinator: NavigationCoordinator;
	release: () => void;
	synchronize: (route: string, pageState: unknown) => Promise<void>;
}

interface InternalNavigationRuntime extends CurrentNavigationRuntime {
	accountGeneration: number;
	deactivate: () => void;
	inactive: Promise<void>;
	ready: Promise<boolean>;
}

type ReadyNavigationRuntime =
	| { kind: "absent" }
	| { kind: "failed" }
	| { kind: "ready"; coordinator: NavigationCoordinator };

export function getCurrentNavigationCoordinator(): NavigationCoordinator | null {
	return currentNavigationRuntime?.coordinator ?? null;
}

async function getReadyNavigationRuntime(): Promise<ReadyNavigationRuntime> {
	while (true) {
		const runtime = currentNavigationRuntime;
		if (!runtime) return { kind: "absent" };
		const configuredTimeout =
			getDeveloperSettingsSnapshot().navigationTransitionTimeoutMs;
		const timeoutMs =
			Number.isFinite(configuredTimeout) && configuredTimeout > 0
				? configuredTimeout
				: 8_000;
		if (runtime.accountGeneration !== getAccountSessionSnapshot().generation) {
			let staleTimeoutId: ReturnType<typeof setTimeout> | null = null;
			const staleResult = await Promise.race([
				runtime.inactive.then<"inactive">(() => "inactive"),
				new Promise<"timeout">((resolve) => {
					staleTimeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
				}),
			]);
			if (staleTimeoutId !== null) clearTimeout(staleTimeoutId);
			if (currentNavigationRuntime !== runtime || staleResult === "inactive")
				continue;
			return { kind: "failed" };
		}
		if (runtime.coordinator.currentState)
			return { kind: "ready", coordinator: runtime.coordinator };

		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const result = await Promise.race([
			runtime.ready.then<"ready" | "inactive">((ready) =>
				ready ? "ready" : "inactive",
			),
			new Promise<"timeout">((resolve) => {
				timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
			}),
		]);
		if (timeoutId !== null) clearTimeout(timeoutId);

		if (currentNavigationRuntime !== runtime) continue;
		if (result === "ready")
			return { kind: "ready", coordinator: runtime.coordinator };
		if (result === "timeout") return { kind: "failed" };
		return { kind: "absent" };
	}
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

async function replaceWithoutNavigationRuntime(
	route: string,
	component: "root" | "detail",
	retry: () => void | Promise<unknown>,
): Promise<NavigationTransitionOutcome | null> {
	try {
		await safeReplacement(route);
		return null;
	} catch {
		const outcome = {
			kind: "failed",
			reason: "navigationError",
		} as const;
		presentNavigationFailure(outcome, component, retry);
		return outcome;
	}
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
		const navigation = await getReadyNavigationRuntime();
		if (navigation.kind === "absent") {
			await replaceWithoutNavigationRuntime(
				DEFAULT_ROOT_ROUTE[root],
				"root",
				() => activateAppRoot(root),
			);
			return;
		}
		if (navigation.kind === "failed") {
			presentNavigationFailure(
				{ kind: "failed", reason: "timeout" },
				"root",
				() => activateAppRoot(root),
			);
			return;
		}
		const { coordinator } = navigation;
		const current = coordinator.currentState;
		if (current?.root === root && current.level === "root") {
			await activateCurrentRootBase(root, current.safeReturnRoute);
			return;
		}
		const outcome = await coordinator.activateCurrentRoot(root);
		presentNavigationFailure(outcome, "root", () => activateAppRoot(root));
	})().finally(() => {
		if (rootActionFlights.get(root) === operation)
			rootActionFlights.delete(root);
	});
	rootActionFlights.set(root, operation);
	return operation;
}

export async function activateAppRootRoute(route: string): Promise<void> {
	const rootRoute = requireRootRoute(route);
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "ready") {
		const { coordinator } = navigation;
		const outcome = await coordinator.activateRootRoute(rootRoute);
		presentNavigationFailure(outcome, "root", () =>
			activateAppRootRoute(rootRoute),
		);
		return;
	}
	if (navigation.kind === "failed") {
		presentNavigationFailure(
			{ kind: "failed", reason: "timeout" },
			"root",
			() => activateAppRootRoute(rootRoute),
		);
		return;
	}
	await replaceWithoutNavigationRuntime(rootRoute, "root", () =>
		activateAppRootRoute(rootRoute),
	);
}

export async function openAppDetail(
	route: string,
	options: DetailNavigationOptions = {},
): Promise<NavigationTransitionOutcome | null> {
	requireDetailRoute(route);
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "ready") {
		const { coordinator } = navigation;
		const outcome = await coordinator.openDetail(route, options);
		presentNavigationFailure(outcome, "detail", () =>
			openAppDetail(route, options),
		);
		return outcome;
	}
	if (navigation.kind === "failed") {
		const outcome = { kind: "failed", reason: "timeout" } as const;
		presentNavigationFailure(outcome, "detail", () =>
			openAppDetail(route, options),
		);
		return outcome;
	}
	return replaceWithoutNavigationRuntime(route, "detail", () =>
		openAppDetail(route, options),
	);
}

export async function replaceAppDetail(
	route: string,
	options: DetailNavigationOptions = {},
): Promise<NavigationTransitionOutcome | null> {
	requireDetailRoute(route);
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "ready") {
		const { coordinator } = navigation;
		const outcome = await coordinator.replaceDetail(route, options);
		presentNavigationFailure(outcome, "detail", () =>
			replaceAppDetail(route, options),
		);
		return outcome;
	}
	if (navigation.kind === "failed") {
		const outcome = { kind: "failed", reason: "timeout" } as const;
		presentNavigationFailure(outcome, "detail", () =>
			replaceAppDetail(route, options),
		);
		return outcome;
	}
	return replaceWithoutNavigationRuntime(route, "detail", () =>
		replaceAppDetail(route, options),
	);
}

export async function closeAppDetail(
	route: string,
	pageState: unknown,
): Promise<void> {
	requireDetailRoute(route);
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "ready") {
		const { coordinator } = navigation;
		await coordinator.closeDetail(route, pageState);
		return;
	}
	if (navigation.kind === "failed") {
		presentNavigationFailure(
			{ kind: "failed", reason: "timeout" },
			"detail",
			() => closeAppDetail(route, pageState),
		);
		return;
	}
	await replaceWithoutNavigationRuntime(
		classifyRoute(route).safeReturnRoute,
		"detail",
		() => closeAppDetail(route, pageState),
	);
}

export async function openInboxConversationDetail(
	route: string,
): Promise<NavigationTransitionOutcome | null> {
	const classification = classifyRoute(route);
	if (
		classification.level !== "detail" ||
		classification.detailKind !== "conversation"
	)
		throw new TypeError("Inbox conversation action requires a conversation");
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "absent") {
		return replaceWithoutNavigationRuntime(route, "detail", () =>
			openInboxConversationDetail(route),
		);
	}
	if (navigation.kind === "failed") {
		const outcome = { kind: "failed", reason: "timeout" } as const;
		presentNavigationFailure(outcome, "detail", () =>
			openInboxConversationDetail(route),
		);
		return outcome;
	}
	const { coordinator } = navigation;
	const current = coordinator.currentState;
	if (
		current?.root !== "inbox" ||
		current.surface !== "inboxChats" ||
		current.safeReturnRoute !== "/chat"
	) {
		const outcome = await coordinator.activateRootRoute("/chat");
		if (outcome.kind !== "committed") {
			presentNavigationFailure(outcome, "root", () =>
				openInboxConversationDetail(route),
			);
			return outcome;
		}
	}
	const outcome = await coordinator.openDetail(route);
	presentNavigationFailure(outcome, "detail", () =>
		openInboxConversationDetail(route),
	);
	return outcome;
}

export async function openReceivedAlbumDetail(
	route: string,
): Promise<NavigationTransitionOutcome | null> {
	const classification = classifyRoute(route);
	if (
		classification.level !== "detail" ||
		classification.detailKind !== "album"
	)
		throw new TypeError("received album action requires an album detail");
	const navigation = await getReadyNavigationRuntime();
	if (navigation.kind === "absent") {
		return replaceWithoutNavigationRuntime(route, "detail", () =>
			openReceivedAlbumDetail(route),
		);
	}
	if (navigation.kind === "failed") {
		const outcome = { kind: "failed", reason: "timeout" } as const;
		presentNavigationFailure(outcome, "detail", () =>
			openReceivedAlbumDetail(route),
		);
		return outcome;
	}
	const { coordinator } = navigation;
	const receivedAlbumParent =
		coordinator.createReceivedAlbumConversationParentProof();
	const outcome = await coordinator.openDetail(
		route,
		receivedAlbumParent ? { receivedAlbumParent } : {},
	);
	presentNavigationFailure(outcome, "detail", () =>
		openReceivedAlbumDetail(route),
	);
	return outcome;
}

export async function interceptAppNavigationClick(
	event: MouseEvent,
	navigate: () => void | Promise<unknown>,
): Promise<void> {
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
	try {
		await navigate();
	} catch {
		// The navigation owner presents bounded failures. An intercepted link must
		// never turn an expected transition rejection into a global app error.
	}
}

export function installCurrentNavigationCoordinator({
	accountGeneration,
	createEntryId,
	effects,
}: NavigationCoordinatorOptions): CurrentNavigationRuntime {
	currentNavigationRuntime?.deactivate();
	const releaseOwnership = runtimeOwnership.acquire("navigation-runtime");
	let active = true;
	let resolveReady!: (ready: boolean) => void;
	let resolveInactive!: () => void;
	let readySettled = false;
	const ready = new Promise<boolean>((resolve) => {
		resolveReady = resolve;
	});
	const inactive = new Promise<void>((resolve) => {
		resolveInactive = resolve;
	});
	const settleReady = (value: boolean) => {
		if (readySettled) return;
		readySettled = true;
		resolveReady(value);
	};
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
		onTransitionFailure: ({ component, outcome, retry }) =>
			presentNavigationFailure(outcome, component, retry),
		transitionTimeoutMs: () =>
			getDeveloperSettingsSnapshot().navigationTransitionTimeoutMs,
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
		settleReady(false);
		resolveInactive();
		releaseOwnership();
	};
	const release = () => {
		deactivate();
		if (currentNavigationRuntime === runtime) currentNavigationRuntime = null;
	};
	const runtime: InternalNavigationRuntime = {
		accountGeneration,
		coordinator,
		deactivate,
		inactive,
		ready,
		release,
		async synchronize(route, pageState) {
			assertCurrent();
			await coordinator.initializeCurrentRoute(route, pageState);
			settleReady(true);
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
