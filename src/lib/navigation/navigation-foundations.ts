import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import { runtimeOwnership } from "$lib/dev/runtime-ownership";

export type RootSurface =
	| "browse"
	| "rightNow"
	| "interest"
	| "inbox"
	| "settings";

export type NavigationLevel = "root" | "detail";

export type DetailKind =
	| "profile"
	| "conversation"
	| "album"
	| "settingsSubpage";

export type NavigationSurface =
	| "browse"
	| "rightNow"
	| "interestTaps"
	| "interestViews"
	| "inboxChats"
	| "inboxAlbums"
	| "settings";

export type SafeReturnRoute =
	| "/"
	| "/right-now"
	| "/interest/taps"
	| "/interest/views"
	| "/chat"
	| "/albums"
	| "/settings"
	| "/settings/account"
	| "/settings/app";

export interface RouteClassification {
	root: RootSurface;
	surface: NavigationSurface;
	level: NavigationLevel;
	safeReturnRoute: SafeReturnRoute;
	detailKind?: DetailKind;
}

export type BackResult = "handled" | "unhandled";

export type BackPriority =
	| "viewer"
	| "dialog"
	| "drawer"
	| "localMode"
	| "route";

export type BackHandler = () => BackResult | Promise<BackResult>;

export interface BackLayerRegistration {
	priority: BackPriority;
	enabled?: boolean;
	handler: BackHandler;
}

const BACK_PRIORITY: Record<BackPriority, number> = {
	viewer: 0,
	dialog: 1,
	drawer: 2,
	localMode: 3,
	route: 4,
};

interface RegisteredBackLayer extends BackLayerRegistration {
	registrationOrder: number;
}

export interface BackLayerSelection {
	selected: boolean;
	result: BackResult;
}

export class BackLayerManager {
	#nextRegistrationOrder = 0;
	#registrations = new Set<RegisteredBackLayer>();

	get size(): number {
		return this.#registrations.size;
	}

	register(registration: BackLayerRegistration): () => void {
		const releaseOwnership = runtimeOwnership.acquire(
			"back-layer-registration",
		);
		const registered = {
			...registration,
			registrationOrder: this.#nextRegistrationOrder++,
		};
		this.#registrations.add(registered);

		return () => {
			this.#registrations.delete(registered);
			releaseOwnership();
		};
	}

	async handleBack(): Promise<BackResult> {
		return (await this.handleBackSelection()).result;
	}

	async handleBackSelection(): Promise<BackLayerSelection> {
		const selected = [...this.#registrations]
			.filter(({ enabled }) => enabled !== false)
			.sort(
				(left, right) =>
					BACK_PRIORITY[left.priority] - BACK_PRIORITY[right.priority] ||
					right.registrationOrder - left.registrationOrder,
			)[0];

		if (!selected) return { selected: false, result: "unhandled" };

		try {
			return { selected: true, result: await selected.handler() };
		} catch {
			return { selected: true, result: "unhandled" };
		}
	}
}

export { BackLayerManager as BackManager };

export interface AppNavigationStateV1 extends RouteClassification {
	app: "open-grind-navigation";
	version: 1;
	entryId: string;
	parentEntryId: string | null;
	accountGeneration: number;
	parentProof?: "validatedReceivedAlbumConversation";
}

declare const receivedAlbumConversationParentBrand: unique symbol;

export interface ValidatedReceivedAlbumConversationParent {
	readonly [receivedAlbumConversationParentBrand]: true;
}

const receivedAlbumConversationParents = new WeakMap<
	object,
	{
		coordinator: NavigationCoordinator;
		conversation: AppNavigationStateV1;
		parent: AppNavigationStateV1;
	}
>();

export interface DetailNavigationOptions {
	receivedAlbumParent?: ValidatedReceivedAlbumConversationParent;
	navigation?: {
		keepFocus?: boolean;
		noScroll?: boolean;
	};
}

const ROOT_ROUTES: Record<string, RouteClassification> = {
	"/": {
		root: "browse",
		surface: "browse",
		level: "root",
		safeReturnRoute: "/",
	},
	"/right-now": {
		root: "rightNow",
		surface: "rightNow",
		level: "root",
		safeReturnRoute: "/right-now",
	},
	"/interest": {
		root: "interest",
		surface: "interestTaps",
		level: "root",
		safeReturnRoute: "/interest/taps",
	},
	"/interest/taps": {
		root: "interest",
		surface: "interestTaps",
		level: "root",
		safeReturnRoute: "/interest/taps",
	},
	"/interest/views": {
		root: "interest",
		surface: "interestViews",
		level: "root",
		safeReturnRoute: "/interest/views",
	},
	"/chat": {
		root: "inbox",
		surface: "inboxChats",
		level: "root",
		safeReturnRoute: "/chat",
	},
	"/albums": {
		root: "inbox",
		surface: "inboxAlbums",
		level: "root",
		safeReturnRoute: "/albums",
	},
	"/settings": {
		root: "settings",
		surface: "settings",
		level: "root",
		safeReturnRoute: "/settings",
	},
};

function pathnameOf(route: string): string {
	try {
		const pathname = new URL(route, "https://open-grind.invalid").pathname;
		return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
	} catch {
		return "/";
	}
}

function settingsSafeParent(pathname: string): SafeReturnRoute {
	if (pathname.startsWith("/settings/account/")) return "/settings/account";
	if (pathname.startsWith("/settings/app/")) return "/settings/app";
	return "/settings";
}

export function classifyRoute(route: string): RouteClassification {
	const pathname = pathnameOf(route);
	const root = ROOT_ROUTES[pathname];
	if (root) return { ...root };

	if (/^\/profile\/[^/]+$/.test(pathname)) {
		return {
			root: "browse",
			surface: "browse",
			level: "detail",
			detailKind: "profile",
			safeReturnRoute: "/",
		};
	}

	if (/^\/chat\/[^/]+$/.test(pathname)) {
		return {
			root: "inbox",
			surface: "inboxChats",
			level: "detail",
			detailKind: "conversation",
			safeReturnRoute: "/chat",
		};
	}

	if (/^\/albums\/[^/]+$/.test(pathname)) {
		return {
			root: "inbox",
			surface: "inboxAlbums",
			level: "detail",
			detailKind: "album",
			safeReturnRoute: "/albums",
		};
	}

	if (pathname.startsWith("/settings/")) {
		return {
			root: "settings",
			surface: "settings",
			level: "detail",
			detailKind: "settingsSubpage",
			safeReturnRoute: settingsSafeParent(pathname),
		};
	}

	return { ...ROOT_ROUTES["/"] };
}

export interface NavigationEffects {
	goto: (
		route: string,
		options: {
			keepFocus?: boolean;
			noScroll?: boolean;
			replaceState: boolean;
			state: AppNavigationStateV1;
		},
	) => void | Promise<void>;
	pop: () => void | Promise<void>;
	replaceState: (
		route: string,
		state: AppNavigationStateV1,
	) => void | Promise<void>;
}

export interface NavigationCoordinatorOptions {
	effects: NavigationEffects;
	accountGeneration: number;
	createEntryId?: () => string;
}

export type CurrentAccountNavigationCoordinatorOptions = Omit<
	NavigationCoordinatorOptions,
	"accountGeneration"
>;

const DEFAULT_ROOT_ROUTE: Record<RootSurface, SafeReturnRoute> = {
	browse: "/",
	rightNow: "/right-now",
	interest: "/interest/taps",
	inbox: "/chat",
	settings: "/settings",
};

const ROOT_SURFACES = new Set<RootSurface>([
	"browse",
	"rightNow",
	"interest",
	"inbox",
	"settings",
]);
const NAVIGATION_SURFACES = new Set<NavigationSurface>([
	"browse",
	"rightNow",
	"interestTaps",
	"interestViews",
	"inboxChats",
	"inboxAlbums",
	"settings",
]);
const SAFE_RETURN_ROUTES = new Set<SafeReturnRoute>([
	"/",
	"/right-now",
	"/interest/taps",
	"/interest/views",
	"/chat",
	"/albums",
	"/settings",
	"/settings/account",
	"/settings/app",
]);
const DETAIL_KINDS = new Set<DetailKind>([
	"profile",
	"conversation",
	"album",
	"settingsSubpage",
]);
const APP_STATE_KEYS = new Set([
	"app",
	"version",
	"entryId",
	"root",
	"surface",
	"level",
	"parentEntryId",
	"safeReturnRoute",
	"accountGeneration",
	"detailKind",
	"parentProof",
]);

function isOpaqueEntryId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function isAppNavigationStateV1(
	value: unknown,
): value is AppNavigationStateV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const state = value as Record<string, unknown>;
	if (Object.keys(state).some((key) => !APP_STATE_KEYS.has(key))) return false;
	if (state.app !== "open-grind-navigation" || state.version !== 1)
		return false;
	if (!isOpaqueEntryId(state.entryId)) return false;
	if (state.parentEntryId !== null && !isOpaqueEntryId(state.parentEntryId))
		return false;
	if (!ROOT_SURFACES.has(state.root as RootSurface)) return false;
	if (!NAVIGATION_SURFACES.has(state.surface as NavigationSurface))
		return false;
	if (state.level !== "root" && state.level !== "detail") return false;
	if (!SAFE_RETURN_ROUTES.has(state.safeReturnRoute as SafeReturnRoute))
		return false;
	if (
		!Number.isSafeInteger(state.accountGeneration) ||
		(state.accountGeneration as number) < 0
	)
		return false;
	const rootSemanticsAreValid = (() => {
		switch (state.root) {
			case "browse":
				return state.surface === "browse" && state.safeReturnRoute === "/";
			case "rightNow":
				return (
					state.surface === "rightNow" && state.safeReturnRoute === "/right-now"
				);
			case "interest":
				return (
					(state.surface === "interestTaps" &&
						state.safeReturnRoute === "/interest/taps") ||
					(state.surface === "interestViews" &&
						state.safeReturnRoute === "/interest/views")
				);
			case "inbox":
				return (
					(state.surface === "inboxChats" &&
						state.safeReturnRoute === "/chat") ||
					(state.surface === "inboxAlbums" &&
						state.safeReturnRoute === "/albums")
				);
			case "settings":
				return (
					state.surface === "settings" &&
					(state.safeReturnRoute === "/settings" ||
						state.safeReturnRoute === "/settings/account" ||
						state.safeReturnRoute === "/settings/app")
				);
		}
	})();
	if (!rootSemanticsAreValid) return false;
	if (state.level === "root")
		return (
			state.detailKind === undefined &&
			state.parentEntryId === null &&
			state.parentProof === undefined &&
			ROOT_ROUTES[state.safeReturnRoute as string] !== undefined
		);
	if (!DETAIL_KINDS.has(state.detailKind as DetailKind)) return false;
	if (state.detailKind === "settingsSubpage")
		return state.root === "settings" && state.parentProof === undefined;
	if (state.detailKind === "album") {
		if (state.parentProof === "validatedReceivedAlbumConversation")
			return (
				state.parentEntryId !== null &&
				state.root === "inbox" &&
				state.surface === "inboxChats" &&
				state.safeReturnRoute === "/chat"
			);
		return (
			state.parentProof === undefined &&
			state.root === "inbox" &&
			state.surface === "inboxAlbums" &&
			state.safeReturnRoute === "/albums"
		);
	}
	if (state.parentEntryId === null && state.detailKind === "profile")
		return (
			state.parentProof === undefined &&
			state.root === "browse" &&
			state.surface === "browse" &&
			state.safeReturnRoute === "/"
		);
	if (state.parentEntryId === null && state.detailKind === "conversation")
		return (
			state.parentProof === undefined &&
			state.root === "inbox" &&
			state.surface === "inboxChats" &&
			state.safeReturnRoute === "/chat"
		);
	return state.parentProof === undefined;
}

function sameAppNavigationState(
	left: AppNavigationStateV1,
	right: AppNavigationStateV1,
): boolean {
	return (
		left.entryId === right.entryId &&
		left.parentEntryId === right.parentEntryId &&
		left.accountGeneration === right.accountGeneration &&
		left.root === right.root &&
		left.surface === right.surface &&
		left.level === right.level &&
		left.detailKind === right.detailKind &&
		left.parentProof === right.parentProof &&
		left.safeReturnRoute === right.safeReturnRoute
	);
}

function defaultEntryId(): string {
	return crypto.randomUUID();
}

export class NavigationCoordinator {
	readonly #effects: NavigationEffects;
	readonly #accountGeneration: number;
	readonly #createEntryId: () => string;
	#currentState: AppNavigationStateV1 | null = null;
	#lastRootRoute: Record<RootSurface, SafeReturnRoute> = {
		...DEFAULT_ROOT_ROUTE,
	};
	#predecessors = new Map<string, AppNavigationStateV1>();
	#transitionTail: Promise<void> = Promise.resolve();

	constructor({
		effects,
		accountGeneration,
		createEntryId = defaultEntryId,
	}: NavigationCoordinatorOptions) {
		if (!Number.isSafeInteger(accountGeneration) || accountGeneration < 0)
			throw new TypeError(
				"accountGeneration must be a non-negative safe integer",
			);
		this.#effects = effects;
		this.#accountGeneration = accountGeneration;
		this.#createEntryId = createEntryId;
	}

	get currentState(): AppNavigationStateV1 | null {
		return this.#currentState;
	}

	initializeCurrentRoute(
		route: string,
		pageState: unknown,
	): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => this.#initializeCurrentRoute(route, pageState));
	}

	async #initializeCurrentRoute(
		route: string,
		pageState: unknown,
	): Promise<AppNavigationStateV1> {
		const classification = classifyRoute(route);
		if (this.#canSynchronizeCurrentRoute(classification, pageState)) {
			this.#currentState = pageState;
			this.#rememberRootRoute(pageState);
			return pageState;
		}

		const state = this.#createState(classification, null);
		await this.#effects.replaceState("", state);
		this.#predecessors.clear();
		this.#currentState = state;
		this.#rememberRootRoute(classification);
		return state;
	}

	switchRoot(root: RootSurface): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => this.#switchRoot(root));
	}

	activateRootRoute(route: string): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => this.#activateRootRoute(route));
	}

	activateCurrentRoot(root?: RootSurface): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => {
			const selectedRoot = root ?? this.#currentState?.root ?? "browse";
			const route =
				this.#currentState?.root === selectedRoot &&
				ROOT_ROUTES[this.#currentState.safeReturnRoute]
					? this.#currentState.safeReturnRoute
					: this.#lastRootRoute[selectedRoot];
			return this.#activateRootRoute(route);
		});
	}

	#enqueue<T>(transition: () => Promise<T>): Promise<T> {
		const result = this.#transitionTail.then(transition);
		this.#transitionTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async #switchRoot(root: RootSurface): Promise<AppNavigationStateV1> {
		return this.#activateRootRoute(this.#lastRootRoute[root]);
	}

	async #activateRootRoute(route: string): Promise<AppNavigationStateV1> {
		const pathname = pathnameOf(route);
		const classification = ROOT_ROUTES[pathname];
		if (!classification)
			throw new TypeError("activateRootRoute requires a root route");
		const canonicalRoute = classification.safeReturnRoute;
		const state = this.#createState(classification, null);
		await this.#effects.goto(canonicalRoute, { replaceState: true, state });
		this.#predecessors.clear();
		this.#currentState = state;
		this.#rememberRootRoute(classification);
		return state;
	}

	createReceivedAlbumConversationParentProof(): ValidatedReceivedAlbumConversationParent | null {
		const conversation = this.#currentState;
		if (
			conversation?.level !== "detail" ||
			conversation.detailKind !== "conversation" ||
			conversation.root !== "inbox" ||
			conversation.surface !== "inboxChats" ||
			conversation.safeReturnRoute !== "/chat"
		)
			return null;
		const parent = this.#predecessors.get(conversation.entryId);
		if (
			!parent ||
			conversation.parentEntryId !== parent.entryId ||
			parent.accountGeneration !== this.#accountGeneration ||
			parent.level !== "root" ||
			parent.root !== "inbox" ||
			parent.surface !== "inboxChats" ||
			parent.safeReturnRoute !== "/chat"
		)
			return null;
		const capability = Object.freeze(
			Object.create(null),
		) as ValidatedReceivedAlbumConversationParent;
		receivedAlbumConversationParents.set(capability, {
			coordinator: this,
			conversation,
			parent,
		});
		return capability;
	}

	openDetail(
		route: string,
		options: DetailNavigationOptions = {},
	): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => this.#openDetail(route, options));
	}

	async #openDetail(
		route: string,
		options: DetailNavigationOptions,
	): Promise<AppNavigationStateV1> {
		const classification = classifyRoute(route);
		if (classification.level !== "detail")
			throw new TypeError("openDetail requires a detail route");

		const current = this.#currentState;
		const parent =
			current?.level === "root"
				? current
				: current?.level === "detail"
					? (this.#predecessors.get(current.entryId) ?? null)
					: null;
		const semanticParent = this.#resolveSemanticParent(
			classification,
			parent,
			options,
		);
		const state = this.#createState(
			semanticParent.classification,
			semanticParent.parent,
			semanticParent.parentProof,
		);
		await this.#effects.goto(route, {
			...options.navigation,
			replaceState: current?.level !== "root",
			state,
		});
		if (current?.level === "detail") this.#predecessors.delete(current.entryId);
		if (semanticParent.parent)
			this.#predecessors.set(state.entryId, semanticParent.parent);
		this.#currentState = state;
		return state;
	}

	replaceDetail(
		route: string,
		options: DetailNavigationOptions = {},
	): Promise<AppNavigationStateV1> {
		return this.#enqueue(() => this.#replaceDetail(route, options));
	}

	async #replaceDetail(
		route: string,
		options: DetailNavigationOptions,
	): Promise<AppNavigationStateV1> {
		const classification = classifyRoute(route);
		if (classification.level !== "detail")
			throw new TypeError("replaceDetail requires a detail route");

		const current = this.#currentState;
		const predecessor =
			current?.level === "detail"
				? (this.#predecessors.get(current.entryId) ?? null)
				: null;
		const semanticParent = this.#resolveSemanticParent(
			classification,
			predecessor,
			options,
		);
		const state = this.#createState(
			semanticParent.classification,
			semanticParent.parent,
			semanticParent.parentProof,
		);
		await this.#effects.goto(route, {
			...options.navigation,
			replaceState: true,
			state,
		});
		if (current?.level === "detail") this.#predecessors.delete(current.entryId);
		if (semanticParent.parent)
			this.#predecessors.set(state.entryId, semanticParent.parent);
		this.#currentState = state;
		return state;
	}

	closeDetail(route: string, pageState: unknown): Promise<BackResult> {
		return this.#enqueue(() => this.#closeDetail(route, pageState));
	}

	async #closeDetail(route: string, pageState: unknown): Promise<BackResult> {
		if (this.#canPopDetail(route, pageState)) {
			const detail = pageState;
			const parent = this.#predecessors.get(detail.entryId);
			if (parent) {
				await this.#effects.pop();
				this.#predecessors.delete(detail.entryId);
				this.#currentState = parent;
				return "handled";
			}
		}

		await this.#replaceSafeParent(route);
		return "handled";
	}

	handleSemanticBack(route: string, pageState: unknown): Promise<BackResult> {
		return this.#enqueue(() => this.#handleSemanticBack(route, pageState));
	}

	async #handleSemanticBack(
		route: string,
		pageState: unknown,
	): Promise<BackResult> {
		const classification = classifyRoute(route);
		if (classification.level === "detail")
			return this.#closeDetail(route, pageState);
		if (classification.root === "browse") return "unhandled";
		await this.#switchRoot("browse");
		return "handled";
	}

	#resolveSemanticParent(
		classification: RouteClassification,
		candidate: AppNavigationStateV1 | null,
		options: DetailNavigationOptions,
	): {
		classification: RouteClassification;
		parent: AppNavigationStateV1 | null;
		parentProof?: "validatedReceivedAlbumConversation";
	} {
		if (!candidate) return { classification, parent: null };
		if (classification.detailKind === "album") {
			const proof = options.receivedAlbumParent;
			const capability =
				proof && typeof proof === "object"
					? receivedAlbumConversationParents.get(proof)
					: undefined;
			if (
				capability?.coordinator === this &&
				capability.conversation === this.#currentState &&
				capability.parent === candidate &&
				candidate.accountGeneration === this.#accountGeneration &&
				candidate.level === "root" &&
				candidate.root === "inbox" &&
				candidate.surface === "inboxChats" &&
				candidate.safeReturnRoute === "/chat"
			) {
				return {
					classification: {
						...classification,
						root: "inbox",
						safeReturnRoute: "/chat",
						surface: "inboxChats",
					},
					parent: candidate,
					parentProof: "validatedReceivedAlbumConversation",
				};
			}
			if (
				candidate.level === "root" &&
				candidate.root === "inbox" &&
				candidate.surface === "inboxAlbums" &&
				candidate.safeReturnRoute === "/albums"
			)
				return { classification, parent: candidate };
			return { classification, parent: null };
		}
		if (classification.detailKind === "settingsSubpage") {
			if (candidate.root !== "settings")
				return { classification, parent: null };
			return { classification, parent: candidate };
		}
		return {
			classification: {
				...classification,
				root: candidate.root,
				safeReturnRoute: candidate.safeReturnRoute,
				surface: candidate.surface,
			},
			parent: candidate,
		};
	}

	#canSynchronizeCurrentRoute(
		classification: RouteClassification,
		pageState: unknown,
	): pageState is AppNavigationStateV1 {
		if (
			!isAppNavigationStateV1(pageState) ||
			pageState.accountGeneration !== this.#accountGeneration ||
			!this.#currentState ||
			!sameAppNavigationState(pageState, this.#currentState) ||
			pageState.level !== classification.level ||
			pageState.detailKind !== classification.detailKind
		)
			return false;
		if (pageState.level === "root")
			return (
				pageState.parentEntryId === null &&
				pageState.root === classification.root &&
				pageState.surface === classification.surface &&
				pageState.safeReturnRoute === classification.safeReturnRoute
			);
		if (pageState.parentEntryId === null) return true;
		const parent = this.#predecessors.get(pageState.entryId);
		return Boolean(
			parent &&
			parent.entryId === pageState.parentEntryId &&
			parent.accountGeneration === this.#accountGeneration &&
			parent.level === "root" &&
			parent.root === pageState.root &&
			parent.surface === pageState.surface &&
			parent.safeReturnRoute === pageState.safeReturnRoute,
		);
	}

	#canPopDetail(
		route: string,
		pageState: unknown,
	): pageState is AppNavigationStateV1 {
		if (!isAppNavigationStateV1(pageState) || pageState.level !== "detail")
			return false;
		if (pageState.accountGeneration !== this.#accountGeneration) return false;
		if (
			!this.#currentState ||
			!sameAppNavigationState(pageState, this.#currentState)
		)
			return false;
		const routeClassification = classifyRoute(route);
		if (
			routeClassification.level !== "detail" ||
			routeClassification.detailKind !== pageState.detailKind
		)
			return false;
		const parent = this.#predecessors.get(pageState.entryId);
		return Boolean(
			parent &&
			parent.level === "root" &&
			parent.entryId === pageState.parentEntryId &&
			parent.accountGeneration === this.#accountGeneration &&
			parent.root === pageState.root &&
			parent.surface === pageState.surface &&
			parent.safeReturnRoute === pageState.safeReturnRoute,
		);
	}

	async #replaceSafeParent(route: string): Promise<void> {
		const classification = classifyRoute(route);
		const safeRoute =
			classification.level === "detail"
				? classification.safeReturnRoute
				: DEFAULT_ROOT_ROUTE.browse;
		const state = this.#createState(classifyRoute(safeRoute), null);
		await this.#effects.goto(safeRoute, { replaceState: true, state });
		this.#predecessors.clear();
		this.#currentState = state;
		this.#rememberRootRoute(classifyRoute(safeRoute));
	}

	#rememberRootRoute(classification: RouteClassification): void {
		if (classification.level !== "root") return;
		this.#lastRootRoute[classification.root] = classification.safeReturnRoute;
	}

	#createState(
		classification: RouteClassification,
		parent: AppNavigationStateV1 | null,
		parentProof?: "validatedReceivedAlbumConversation",
	): AppNavigationStateV1 {
		const entryId = this.#createEntryId();
		if (
			typeof entryId !== "string" ||
			entryId.length === 0 ||
			entryId.length > 128
		)
			throw new TypeError("createEntryId must return a bounded opaque string");
		return {
			app: "open-grind-navigation",
			version: 1,
			entryId,
			root: classification.root,
			surface: classification.surface,
			level: classification.level,
			parentEntryId: parent?.entryId ?? null,
			safeReturnRoute: classification.safeReturnRoute,
			accountGeneration: this.#accountGeneration,
			...(classification.detailKind
				? { detailKind: classification.detailKind }
				: {}),
			...(parentProof ? { parentProof } : {}),
		};
	}
}

export function createCurrentAccountNavigationCoordinator(
	options: CurrentAccountNavigationCoordinatorOptions,
): NavigationCoordinator {
	return new NavigationCoordinator({
		...options,
		accountGeneration: getAccountSessionSnapshot().generation,
	});
}
