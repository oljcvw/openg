import { describe, expect, it, vi } from "vitest";

import { getAccountSessionSnapshot } from "$lib/api/account-caches";
import {
	type AppNavigationStateV1,
	BackLayerManager,
	type BackResult,
	classifyRoute,
	createCurrentAccountNavigationCoordinator,
	isAppNavigationStateV1,
	NavigationCoordinator,
	type NavigationTransitionOutcome,
	type ValidatedReceivedAlbumConversationParent,
} from "./navigation-foundations";

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
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function createEffects() {
	return {
		goto: vi.fn<
			(
				route: string,
				options: {
					keepFocus?: boolean;
					noScroll?: boolean;
					replaceState: boolean;
					state: AppNavigationStateV1;
				},
			) => Promise<void>
		>(async () => {}),
		pop: vi.fn(),
		replaceState: vi.fn(),
	};
}

async function closeAfterObservedHistoryTraversal(
	coordinator: NavigationCoordinator,
	route: string,
	detail: AppNavigationStateV1,
	parent: AppNavigationStateV1,
): Promise<BackResult> {
	const closing = coordinator.closeDetail(route, detail);
	await Promise.resolve();
	await coordinator.initializeCurrentRoute(parent.safeReturnRoute, parent);
	return await closing;
}

describe("route classification", () => {
	it("classifies every current root and detail route without retaining route identifiers", () => {
		expect(classifyRoute("/")).toMatchObject({
			root: "browse",
			surface: "browse",
			level: "root",
			safeReturnRoute: "/",
		});
		expect(classifyRoute("/right-now")).toMatchObject({
			root: "rightNow",
			surface: "rightNow",
			level: "root",
		});
		expect(classifyRoute("/interest/taps")).toMatchObject({
			root: "interest",
			surface: "interestTaps",
			level: "root",
		});
		expect(classifyRoute("/interest/views")).toMatchObject({
			root: "interest",
			surface: "interestViews",
			level: "root",
		});
		expect(classifyRoute("/chat")).toMatchObject({
			root: "inbox",
			surface: "inboxChats",
			level: "root",
			safeReturnRoute: "/chat",
		});
		expect(classifyRoute("/albums")).toMatchObject({
			root: "inbox",
			surface: "inboxAlbums",
			level: "root",
			safeReturnRoute: "/albums",
		});
		expect(classifyRoute("/settings")).toMatchObject({
			root: "settings",
			surface: "settings",
			level: "root",
		});
		expect(classifyRoute("/profile/private-profile-id")).toMatchObject({
			detailKind: "profile",
			safeReturnRoute: "/",
		});
		expect(classifyRoute("/chat/private-conversation-id")).toMatchObject({
			detailKind: "conversation",
			safeReturnRoute: "/chat",
		});
		expect(
			classifyRoute("/albums/private-album-id?owner=private-profile-id"),
		).toMatchObject({
			detailKind: "album",
			safeReturnRoute: "/albums",
		});
		expect(classifyRoute("/settings/account/privacy")).toMatchObject({
			detailKind: "settingsSubpage",
			safeReturnRoute: "/settings/account",
		});
	});
});

describe("NavigationCoordinator", () => {
	it.each([
		["/interest/views", "openDetail"],
		["/interest/views", "replaceDetail"],
		["/right-now", "openDetail"],
		["/right-now", "replaceDetail"],
		["/settings", "openDetail"],
		["/settings", "replaceDetail"],
		["/chat", "openDetail"],
		["/chat", "replaceDetail"],
	] as const)(
		"preserves the coordinator-owned profile entry through %s %s synchronization and Back",
		async (rootRoute, transition) => {
			const effects = createEffects();
			const coordinator = new NavigationCoordinator({
				effects,
				accountGeneration: 7,
				createEntryId: (() => {
					let index = 0;
					return () => `entry-${++index}`;
				})(),
			});
			const root = await committed(coordinator.activateRootRoute(rootRoute));
			if (transition === "replaceDetail")
				await coordinator.openDetail("/profile/profile-before-replace");
			const detail = await committed(
				coordinator[transition]("/profile/profile-current"),
			);
			effects.replaceState.mockClear();
			effects.pop.mockClear();

			await expect(
				coordinator.initializeCurrentRoute("/profile/profile-current", detail),
			).resolves.toEqual(detail);
			expect(effects.replaceState).not.toHaveBeenCalled();
			await expect(
				closeAfterObservedHistoryTraversal(
					coordinator,
					"/profile/profile-current",
					detail,
					root,
				),
			).resolves.toBe("handled");
			expect(effects.pop).toHaveBeenCalledOnce();
			expect(coordinator.currentState).toEqual(root);
		},
	);

	it("does not adopt an otherwise valid detail entry in a fresh coordinator", async () => {
		const sourceEffects = createEffects();
		const source = new NavigationCoordinator({
			effects: sourceEffects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `source-${++index}`;
			})(),
		});
		await source.activateRootRoute("/interest/views");
		const unproven = await committed(
			source.openDetail("/profile/profile-current"),
		);
		const reloadEffects = createEffects();
		const reloaded = new NavigationCoordinator({
			effects: reloadEffects,
			accountGeneration: 7,
			createEntryId: () => "reload-entry",
		});

		const initialized = await reloaded.initializeCurrentRoute(
			"/profile/profile-current",
			unproven,
		);

		expect(reloadEffects.replaceState).toHaveBeenCalledOnce();
		expect(initialized).not.toEqual(unproven);
		expect(initialized).toMatchObject({
			parentEntryId: null,
			root: "browse",
			safeReturnRoute: "/",
			surface: "browse",
		});
	});
	it("stamps an initial legacy route by replacement without retaining private route data", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: () => "opaque-entry",
		});

		const state = await coordinator.initializeCurrentRoute(
			"/chat/private-conversation-id?owner=private-profile-id",
			{ legacy: "private-payload" },
		);

		expect(effects.replaceState).toHaveBeenCalledOnce();
		expect(effects.replaceState).toHaveBeenCalledWith("", state);
		expect(effects.goto).not.toHaveBeenCalled();
		expect(effects.pop).not.toHaveBeenCalled();
		expect(state).toMatchObject({
			accountGeneration: 7,
			detailKind: "conversation",
			level: "detail",
			parentEntryId: null,
			safeReturnRoute: "/chat",
		});
		expect(JSON.stringify(state)).not.toContain("private-");
	});

	it("replaces root switches and pushes only the first detail", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});

		await coordinator.switchRoot("inbox");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat",
			expect.objectContaining({ replaceState: true }),
		);

		await coordinator.openDetail("/chat/private-conversation-id");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat/private-conversation-id",
			expect.objectContaining({ replaceState: false }),
		);

		await coordinator.openDetail("/profile/private-profile-id");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/profile/private-profile-id",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("pops only a current app-owned detail whose ledger predecessor proves the parent", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		const root = await committed(coordinator.switchRoot("inbox"));
		const detail = await committed(
			coordinator.openDetail("/chat/private-conversation-id"),
		);

		await expect(
			closeAfterObservedHistoryTraversal(
				coordinator,
				"/chat/private-conversation-id",
				detail,
				root,
			),
		).resolves.toBe("handled");
		expect(effects.pop).toHaveBeenCalledOnce();
		expect(coordinator.currentState).toEqual(root);
	});

	it("commits a browser pop only after the expected route is observed", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `observed-pop-${++index}`;
			})(),
			transitionTimeoutMs: 100,
		});
		const root = await committed(coordinator.activateRootRoute("/chat"));
		const detail = await committed(
			coordinator.openDetail("/chat/conversation-a"),
		);

		const closing = coordinator.closeDetail("/chat/conversation-a", detail);
		await Promise.resolve();
		expect(effects.pop).toHaveBeenCalledOnce();
		expect(coordinator.currentState).toEqual(detail);

		await coordinator.initializeCurrentRoute("/chat", root);
		await expect(closing).resolves.toBe("handled");
		expect(coordinator.currentState).toEqual(root);
	});

	it("times out an unobserved browser pop without corrupting current detail state", async () => {
		const effects = createEffects();
		const onTransitionFailure = vi.fn();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `stalled-pop-${++index}`;
			})(),
			onTransitionFailure,
			transitionTimeoutMs: 5,
		});
		await committed(coordinator.activateRootRoute("/chat"));
		const detail = await committed(
			coordinator.openDetail("/chat/conversation-a"),
		);

		await expect(
			coordinator.closeDetail("/chat/conversation-a", detail),
		).resolves.toBe("handled");

		expect(coordinator.currentState).toEqual(detail);
		expect(onTransitionFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				component: "detail",
				outcome: { kind: "failed", reason: "timeout" },
			}),
		);
	});

	it("accepts app-owned browser Back and Forward without weakening route binding", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `history-entry-${++index}`;
			})(),
		});
		const root = await committed(coordinator.activateRootRoute("/chat"));
		const detail = await committed(
			coordinator.openDetail("/chat/conversation-a"),
		);
		effects.goto.mockClear();

		await expect(
			coordinator.initializeCurrentRoute("/chat", root),
		).resolves.toEqual(root);
		expect(coordinator.currentState).toEqual(root);
		expect(effects.goto).not.toHaveBeenCalled();

		await expect(
			coordinator.initializeCurrentRoute("/chat/conversation-a", detail),
		).resolves.toEqual(detail);
		expect(coordinator.currentState).toEqual(detail);
		expect(effects.goto).not.toHaveBeenCalled();

		await coordinator.initializeCurrentRoute("/chat", root);
		await expect(
			coordinator.initializeCurrentRoute("/chat/conversation-b", detail),
		).resolves.toEqual(root);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat",
			expect.objectContaining({ replaceState: true, state: root }),
		);
	});

	it("refuses to pop when current detail state is paired with a different private route", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `route-bound-${++index}`;
			})(),
		});
		await committed(coordinator.activateRootRoute("/chat"));
		const detail = await committed(
			coordinator.openDetail("/chat/conversation-a"),
		);
		effects.goto.mockClear();

		await expect(
			coordinator.closeDetail("/chat/conversation-b", detail),
		).resolves.toBe("handled");

		expect(effects.pop).not.toHaveBeenCalled();
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it.each([
		["invalid", { app: "unknown" }],
		[
			"stale",
			{ app: "open-grind-navigation", version: 1, accountGeneration: 6 },
		],
		[
			"cross-account",
			{ app: "open-grind-navigation", version: 1, accountGeneration: 8 },
		],
	])(
		"safely replaces %s detail state instead of blind traversal",
		async (_, invalidState) => {
			const effects = createEffects();
			const coordinator = new NavigationCoordinator({
				effects,
				accountGeneration: 7,
				createEntryId: () => "safe-entry",
			});

			await expect(
				coordinator.closeDetail("/profile/private-profile-id", invalidState),
			).resolves.toBe("handled");
			expect(effects.pop).not.toHaveBeenCalled();
			expect(effects.goto).toHaveBeenLastCalledWith(
				"/",
				expect.objectContaining({ replaceState: true }),
			);
		},
	);

	it("uses semantic root Back and leaves Browse Back unhandled", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: () => "entry",
		});
		const inbox = await committed(coordinator.switchRoot("inbox"));

		await expect(coordinator.handleSemanticBack("/chat", inbox)).resolves.toBe(
			"handled",
		);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/",
			expect.objectContaining({ replaceState: true }),
		);

		const browse = coordinator.currentState;
		await expect(coordinator.handleSemanticBack("/", browse)).resolves.toBe(
			"unhandled",
		);
	});

	it("activates the current root and explicitly replaces a detail", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});

		await coordinator.switchRoot("inbox");
		await coordinator.activateCurrentRoot();
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat",
			expect.objectContaining({ replaceState: true }),
		);

		await coordinator.replaceDetail("/profile/private-profile-id");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/profile/private-profile-id",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("keeps adjacent-detail focus and scroll options inside the coordinator effect", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: () => "entry",
		});
		await coordinator.activateRootRoute("/");

		await coordinator.replaceDetail("/profile/profile-b", {
			navigation: { keepFocus: true, noScroll: true },
		});
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/profile/profile-b",
			expect.objectContaining({
				keepFocus: true,
				noScroll: true,
				replaceState: true,
			}),
		);
	});

	it("walks an unproven settings subpage through its semantic safe parents", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: () => "safe-entry",
		});

		await coordinator.closeDetail("/settings/account/privacy", null);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/settings/account",
			expect.objectContaining({ replaceState: true }),
		);

		await coordinator.handleSemanticBack(
			"/settings/account",
			coordinator.currentState,
		);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/settings",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("uses semantic settings ancestry without replaying the historical child stack", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `settings-${++index}`;
			})(),
		});
		await coordinator.activateRootRoute("/settings");
		await coordinator.openDetail("/settings/account");
		const privacy = await committed(
			coordinator.openDetail("/settings/account/privacy"),
		);
		expect(privacy.safeReturnRoute).toBe("/settings/account");

		await coordinator.closeDetail("/settings/account/privacy", privacy);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/settings/account",
			expect.objectContaining({ replaceState: true }),
		);
		await coordinator.handleSemanticBack(
			"/settings/account",
			coordinator.currentState,
		);
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/settings",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("stores only provenance and uses the existing account session generation", async () => {
		const effects = createEffects();
		const coordinator = createCurrentAccountNavigationCoordinator({
			effects,
			createEntryId: () => "opaque-entry",
		});
		await coordinator.switchRoot("inbox");
		const state = await committed(
			coordinator.openDetail("/chat/private-conversation-id"),
		);

		expect(state.accountGeneration).toBe(
			getAccountSessionSnapshot().generation,
		);
		expect(Object.keys(state).sort()).toEqual(
			[
				"accountGeneration",
				"app",
				"detailKind",
				"entryId",
				"level",
				"parentEntryId",
				"root",
				"safeReturnRoute",
				"surface",
				"version",
			].sort(),
		);
		expect(JSON.stringify(state)).not.toContain("private-conversation-id");
	});
});

describe("reviewed navigation invariants", () => {
	it("remembers the current account session's Inbox and Interest sibling selections", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});

		await coordinator.activateRootRoute("/albums");
		await coordinator.switchRoot("browse");
		await coordinator.switchRoot("inbox");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/albums",
			expect.objectContaining({ replaceState: true }),
		);

		await coordinator.activateRootRoute("/interest/views");
		await coordinator.switchRoot("settings");
		await coordinator.switchRoot("interest");
		expect(effects.goto).toHaveBeenLastCalledWith(
			"/interest/views",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("targets the canonical Interest default directly without a redirect entry", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: () => "entry",
		});

		await coordinator.switchRoot("interest");
		expect(effects.goto).toHaveBeenCalledOnce();
		expect(effects.goto).toHaveBeenCalledWith(
			"/interest/taps",
			expect.objectContaining({ replaceState: true }),
		);
	});

	it("adopts secondary root routes from initial and active states", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});

		const views = await committed(
			coordinator.activateRootRoute("/interest/views"),
		);
		expect(views).toMatchObject({
			level: "root",
			root: "interest",
			safeReturnRoute: "/interest/views",
			surface: "interestViews",
		});
		const albums = await committed(coordinator.activateRootRoute("/albums"));
		expect(albums).toMatchObject({
			level: "root",
			root: "inbox",
			safeReturnRoute: "/albums",
			surface: "inboxAlbums",
		});
		expect(effects.goto).toHaveBeenNthCalledWith(
			1,
			"/interest/views",
			expect.objectContaining({ replaceState: true }),
		);
		expect(effects.goto).toHaveBeenNthCalledWith(
			2,
			"/albums",
			expect.objectContaining({ replaceState: true }),
		);
		await expect(
			coordinator.activateRootRoute("/chat/private-conversation-id"),
		).resolves.toEqual({ kind: "failed", reason: "invalidState" });
	});

	it("requires explicit current proof before an album can return to Chats", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await coordinator.activateRootRoute("/chat");
		const unvalidated = await committed(
			coordinator.openDetail("/albums/private-album-id"),
		);
		expect(unvalidated).toMatchObject({
			parentEntryId: null,
			root: "inbox",
			safeReturnRoute: "/albums",
			surface: "inboxAlbums",
		});

		const chats = await committed(coordinator.activateRootRoute("/chat"));
		await coordinator.openDetail("/chat/private-conversation-id");
		const proof = coordinator.createReceivedAlbumConversationParentProof();
		expect(proof).not.toBeNull();
		const validated = await committed(
			coordinator.openDetail("/albums/private-album-id", {
				receivedAlbumParent: proof!,
			}),
		);
		expect(validated).toMatchObject({
			parentEntryId: chats.entryId,
			parentProof: "validatedReceivedAlbumConversation",
			root: "inbox",
			safeReturnRoute: "/chat",
			surface: "inboxChats",
		});

		await coordinator.activateRootRoute("/chat");
		await coordinator.openDetail("/chat/another-conversation-id");
		const stale = await committed(
			coordinator.openDetail("/albums/private-album-id", {
				receivedAlbumParent: proof!,
			}),
		);
		expect(stale.safeReturnRoute).toBe("/albums");
		expect(stale.parentEntryId).toBeNull();
	});

	it("rejects a structural lookalike cast as a received-album capability", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await coordinator.activateRootRoute("/chat");
		await coordinator.openDetail("/chat/private-conversation-id");
		const lookalike = {
			accountGeneration: 7,
			kind: "validatedReceivedAlbumConversationParent",
			parentEntryId: "entry-1",
		} as unknown as ValidatedReceivedAlbumConversationParent;

		const album = await committed(
			coordinator.openDetail("/albums/private-album-id", {
				receivedAlbumParent: lookalike,
			}),
		);

		expect(album).toMatchObject({
			parentEntryId: null,
			root: "inbox",
			safeReturnRoute: "/albums",
			surface: "inboxAlbums",
		});
	});

	it("preserves a proven received album through synchronization and Back", async () => {
		const effects = createEffects();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		const chats = await committed(coordinator.activateRootRoute("/chat"));
		await coordinator.openDetail("/chat/private-conversation-id");
		const proof = coordinator.createReceivedAlbumConversationParentProof();
		expect(proof).not.toBeNull();
		const album = await committed(
			coordinator.openDetail("/albums/private-album-id", {
				receivedAlbumParent: proof!,
			}),
		);
		effects.replaceState.mockClear();
		effects.pop.mockClear();

		await expect(
			coordinator.initializeCurrentRoute("/albums/private-album-id", album),
		).resolves.toEqual(album);
		expect(effects.replaceState).not.toHaveBeenCalled();
		await closeAfterObservedHistoryTraversal(
			coordinator,
			"/albums/private-album-id",
			album,
			chats,
		);
		expect(effects.pop).toHaveBeenCalledOnce();
		expect(coordinator.currentState).toEqual(chats);
	});

	it("supersedes a deferred first detail without replacing its root history", async () => {
		const effects = createEffects();
		const pending = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await coordinator.switchRoot("inbox");
		effects.goto.mockClear();
		effects.goto
			.mockImplementationOnce(() => pending.promise)
			.mockResolvedValueOnce(undefined);

		const first = coordinator.openDetail("/chat/conversation-one");
		const second = coordinator.openDetail("/profile/profile-two");
		await Promise.resolve();
		expect(effects.goto).toHaveBeenCalledTimes(2);
		await expect(second).resolves.toMatchObject({
			kind: "committed",
			state: { detailKind: "profile" },
		});
		pending.resolve();
		await expect(first).resolves.toEqual({ kind: "superseded" });
		expect(effects.goto).toHaveBeenNthCalledWith(
			1,
			"/chat/conversation-one",
			expect.objectContaining({ replaceState: false }),
		);
		expect(effects.goto).toHaveBeenNthCalledWith(
			2,
			"/profile/profile-two",
			expect.objectContaining({ replaceState: false }),
		);
		expect(coordinator.currentState?.detailKind).toBe("profile");
	});

	it("lets a root intent supersede a never-resolving detail transition", async () => {
		const effects = createEffects();
		const gotoPending = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await coordinator.switchRoot("inbox");
		effects.goto.mockClear();
		effects.goto
			.mockImplementationOnce(() => gotoPending.promise)
			.mockResolvedValueOnce(undefined);
		const detailOpen = coordinator.openDetail("/chat/conversation-one");
		const rootSwitch = coordinator.activateRootRoute("/interest/views");
		await Promise.resolve();
		expect(effects.goto).toHaveBeenCalledTimes(2);
		await expect(rootSwitch).resolves.toMatchObject({
			kind: "committed",
			state: { surface: "interestViews" },
		});
		gotoPending.resolve();
		await expect(detailOpen).resolves.toEqual({ kind: "superseded" });
		expect(coordinator.currentState?.surface).toBe("interestViews");
	});

	it("returns a typed failure without rolling back a newer committed intent", async () => {
		const effects = createEffects();
		const rejected = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		const committed = await coordinator.switchRoot("inbox");
		effects.goto.mockClear();
		effects.goto
			.mockImplementationOnce(() => rejected.promise)
			.mockResolvedValueOnce(undefined);
		const failed = coordinator.openDetail("/chat/conversation-one");
		const recovery = coordinator.activateRootRoute("/albums");
		await Promise.resolve();
		expect(effects.goto).toHaveBeenCalledTimes(2);
		await expect(recovery).resolves.toMatchObject({
			kind: "committed",
			state: { surface: "inboxAlbums" },
		});
		rejected.reject(new Error("effect failed"));
		await expect(failed).resolves.toEqual({ kind: "superseded" });
		expect(coordinator.currentState).not.toEqual(committed);
		expect(coordinator.currentState?.surface).toBe("inboxAlbums");
	});

	it("times out a stalled transition with a bounded typed failure", async () => {
		const effects = createEffects();
		effects.goto.mockImplementation(() => new Promise(() => {}));
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			transitionTimeoutMs: 5,
			createEntryId: () => "timeout-entry",
		});

		await expect(coordinator.activateRootRoute("/chat")).resolves.toEqual({
			kind: "failed",
			reason: "timeout",
		});
		expect(coordinator.currentState).toBeNull();
	});

	it("commits from observed route synchronization even when goto never settles", async () => {
		const effects = createEffects();
		const gotoPending = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			transitionTimeoutMs: 100,
			createEntryId: () => "observed-entry",
		});
		await committed(coordinator.activateRootRoute("/chat"));
		effects.goto.mockImplementationOnce(() => gotoPending.promise);

		const opening = coordinator.openDetail("/chat/conversation-current");
		const observedState = effects.goto.mock.calls.at(-1)?.[1].state;
		expect(observedState).toBeDefined();
		await coordinator.initializeCurrentRoute(
			"/chat/conversation-current",
			observedState,
		);

		await expect(opening).resolves.toEqual({
			kind: "committed",
			state: observedState,
		});
		expect(coordinator.currentState).toEqual(observedState);
		gotoPending.resolve();
	});

	it("does not bind a pending conversation state to a different conversation URL", async () => {
		const effects = createEffects();
		const firstGoto = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await committed(coordinator.activateRootRoute("/chat"));
		effects.goto
			.mockImplementationOnce(() => firstGoto.promise)
			.mockResolvedValueOnce(undefined);

		const opening = coordinator.openDetail("/chat/conversation-a");
		const pendingState = effects.goto.mock.calls.at(-1)?.[1].state;
		await coordinator.initializeCurrentRoute(
			"/chat/conversation-b",
			pendingState,
		);

		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat/conversation-a",
			expect.objectContaining({ replaceState: true, state: pendingState }),
		);
		await expect(opening).resolves.toMatchObject({
			kind: "committed",
			state: pendingState,
		});
		firstGoto.resolve();
	});

	it("keeps the expected album owner query in the in-memory route fence", async () => {
		const effects = createEffects();
		const firstGoto = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `album-entry-${++index}`;
			})(),
		});
		await committed(coordinator.activateRootRoute("/albums"));
		effects.goto
			.mockImplementationOnce(() => firstGoto.promise)
			.mockResolvedValueOnce(undefined);

		const opening = coordinator.openDetail("/albums/9?owner=owner-a");
		const pendingState = effects.goto.mock.calls.at(-1)?.[1].state;
		await coordinator.initializeCurrentRoute(
			"/albums/9?owner=owner-b",
			pendingState,
		);

		expect(effects.goto).toHaveBeenLastCalledWith(
			"/albums/9?owner=owner-a",
			expect.objectContaining({ replaceState: true, state: pendingState }),
		);
		await expect(opening).resolves.toMatchObject({ kind: "committed" });
		firstGoto.resolve();
	});

	it("fences a superseded route that arrives after a newer detail committed", async () => {
		const effects = createEffects();
		const staleGoto = deferred<void>();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		await committed(coordinator.activateRootRoute("/chat"));
		effects.goto
			.mockImplementationOnce(() => staleGoto.promise)
			.mockResolvedValue(undefined);

		const staleOpening = coordinator.openDetail("/chat/conversation-a");
		const staleState = effects.goto.mock.calls.at(-1)?.[1].state;
		const current = await committed(
			coordinator.openDetail("/chat/conversation-b"),
		);
		await expect(staleOpening).resolves.toEqual({ kind: "superseded" });

		await coordinator.initializeCurrentRoute(
			"/chat/conversation-a",
			staleState,
		);

		expect(effects.goto).toHaveBeenLastCalledWith(
			"/chat/conversation-b",
			expect.objectContaining({ replaceState: true, state: current }),
		);
		expect(coordinator.currentState).toEqual(current);
		staleGoto.resolve();
	});

	it("consumes semantic Back failures without falsely delegating to task backgrounding", async () => {
		const effects = createEffects();
		const onTransitionFailure = vi.fn();
		const coordinator = new NavigationCoordinator({
			effects,
			accountGeneration: 7,
			onTransitionFailure,
			createEntryId: (() => {
				let index = 0;
				return () => `entry-${++index}`;
			})(),
		});
		const inbox = await committed(coordinator.activateRootRoute("/chat"));
		effects.goto.mockRejectedValueOnce(new Error("replacement failed"));

		await expect(coordinator.handleSemanticBack("/chat", inbox)).resolves.toBe(
			"handled",
		);
		expect(coordinator.currentState).toEqual(inbox);
		expect(onTransitionFailure).toHaveBeenLastCalledWith(
			expect.objectContaining({
				component: "root",
				outcome: { kind: "failed", reason: "navigationError" },
				retry: expect.any(Function),
			}),
		);

		const detail = await committed(
			coordinator.openDetail("/chat/conversation-current"),
		);
		effects.pop.mockRejectedValueOnce(new Error("pop failed"));
		await expect(
			coordinator.closeDetail("/chat/conversation-current", detail),
		).resolves.toBe("handled");
		expect(coordinator.currentState).toEqual(detail);
		expect(onTransitionFailure).toHaveBeenLastCalledWith(
			expect.objectContaining({
				component: "detail",
				outcome: { kind: "failed", reason: "navigationError" },
				retry: expect.any(Function),
			}),
		);
		expect(onTransitionFailure).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			accountGeneration: 7,
			app: "open-grind-navigation",
			entryId: "entry",
			level: "root",
			parentEntryId: null,
			root: "browse",
			safeReturnRoute: "/",
			surface: "settings",
			version: 1,
		},
		{
			accountGeneration: 7,
			app: "open-grind-navigation",
			entryId: "entry",
			level: "root",
			parentEntryId: "impossible-parent",
			root: "browse",
			safeReturnRoute: "/",
			surface: "browse",
			version: 1,
		},
		{
			accountGeneration: 7,
			app: "open-grind-navigation",
			detailKind: "album",
			entryId: "entry",
			level: "detail",
			parentEntryId: "chat-root",
			root: "inbox",
			safeReturnRoute: "/chat",
			surface: "inboxChats",
			version: 1,
		},
		{
			accountGeneration: 7,
			app: "open-grind-navigation",
			detailKind: "profile",
			entryId: "entry",
			level: "detail",
			parentEntryId: null,
			root: "settings",
			safeReturnRoute: "/settings",
			surface: "settings",
			version: 1,
		},
		{
			accountGeneration: 7,
			app: "open-grind-navigation",
			detailKind: "conversation",
			entryId: "entry",
			level: "detail",
			parentEntryId: null,
			root: "browse",
			safeReturnRoute: "/",
			surface: "browse",
			version: 1,
		},
	])("rejects impossible versioned state %#", (state) => {
		expect(isAppNavigationStateV1(state)).toBe(false);
	});
});

describe("BackLayerManager", () => {
	it("uses priority then newest registration, only calls one layer, and supports disabled layers", async () => {
		const manager = new BackLayerManager();
		const route = vi.fn<() => BackResult>(() => "handled");
		const oldestViewer = vi.fn<() => BackResult>(() => "handled");
		const newestViewer = vi.fn<() => BackResult>(() => "unhandled");
		const disabledDialog = vi.fn<() => BackResult>(() => "handled");

		manager.register({ priority: "route", handler: route });
		manager.register({ priority: "viewer", handler: oldestViewer });
		manager.register({ priority: "viewer", handler: newestViewer });
		manager.register({
			priority: "dialog",
			enabled: false,
			handler: disabledDialog,
		});

		await expect(manager.handleBack()).resolves.toBe("unhandled");
		expect(newestViewer).toHaveBeenCalledOnce();
		expect(oldestViewer).not.toHaveBeenCalled();
		expect(route).not.toHaveBeenCalled();
		expect(disabledDialog).not.toHaveBeenCalled();
	});

	it("handles async results and makes cleanup idempotent across mount cycles", async () => {
		const manager = new BackLayerManager();
		const cleanup = manager.register({
			priority: "drawer",
			handler: () => Promise.resolve<BackResult>("handled"),
		});
		expect(manager.size).toBe(1);
		await expect(manager.handleBack()).resolves.toBe("handled");
		cleanup();
		cleanup();
		expect(manager.size).toBe(0);
	});

	it("treats rejected handlers as unhandled without cascading", async () => {
		const manager = new BackLayerManager();
		const fallback = vi.fn<() => BackResult>(() => "handled");
		manager.register({ priority: "route", handler: fallback });
		manager.register({
			priority: "localMode",
			handler: async () => Promise.reject(new Error("private input")),
		});

		await expect(manager.handleBack()).resolves.toBe("unhandled");
		expect(fallback).not.toHaveBeenCalled();
	});
});
