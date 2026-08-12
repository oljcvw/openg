import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationMediaViewerState } from "$lib/chat/conversation-media-viewer.svelte";
import { backLayerManager } from "$lib/navigation/app-navigation";

const reportViewerDiagnosticMock = vi.hoisted(() => vi.fn());
vi.mock("$lib/platform/client-diagnostics", () => ({
	reportViewerDiagnostic: reportViewerDiagnosticMock,
}));

describe("ConversationMediaViewerState", () => {
	let viewer: ConversationMediaViewerState | null = null;

	beforeEach(() => {
		expect(backLayerManager.size).toBe(0);
		reportViewerDiagnosticMock.mockReset();
	});

	afterEach(() => {
		viewer?.close();
		viewer = null;
		expect(backLayerManager.size).toBe(0);
	});

	it("keeps one owner while replacing sessions and pins only the open message", () => {
		const pin = vi.fn();
		const unpin = vi.fn();
		viewer = new ConversationMediaViewerState({ pin, unpin });

		viewer.open({
			items: [{ id: "one", kind: "image", url: "https://example.test/1" }],
			startId: "one",
			messageId: "message-one",
			opener: null,
		});
		viewer.open({
			items: [{ id: "two", kind: "video", url: "https://example.test/2" }],
			startId: "two",
			messageId: "message-two",
			opener: null,
		});

		expect(viewer.ownerCount).toBe(1);
		expect(viewer.startIndex).toBe(0);
		expect(pin).toHaveBeenNthCalledWith(1, "message-one");
		expect(unpin).toHaveBeenCalledWith("message-one");
		expect(pin).toHaveBeenNthCalledWith(2, "message-two");

		viewer.close();
		expect(viewer.ownerCount).toBe(0);
		expect(unpin).toHaveBeenCalledWith("message-two");
	});

	it("owns and pins an explicit authorization session before resolving media", async () => {
		const pin = vi.fn();
		const unpin = vi.fn();
		viewer = new ConversationMediaViewerState({ pin, unpin });
		let resolveSession!: (session: {
			items: Array<{ id: string; kind: "image"; url: string }>;
			startId: string;
		}) => void;
		const resolver = vi.fn((signal: AbortSignal) => {
			void signal;
			return new Promise<{
				items: Array<{ id: string; kind: "image"; url: string }>;
				startId: string;
			}>((resolve) => (resolveSession = resolve));
		});

		const opening = viewer.openExplicit({
			messageId: "view-once-message",
			opener: null,
			resolve: resolver,
		});

		expect(viewer.ownerCount).toBe(1);
		expect(viewer.ready).toBe(false);
		expect(pin).toHaveBeenCalledWith("view-once-message");
		expect(resolver).toHaveBeenCalledOnce();

		resolveSession({
			items: [{ id: "authorized", kind: "image", url: "media://once" }],
			startId: "authorized",
		});
		await expect(opening).resolves.toBe(true);
		expect(viewer.ready).toBe(true);
		expect(viewer.items[0]?.url).toBe("media://once");

		viewer.close();
		expect(unpin).toHaveBeenCalledWith("view-once-message");
		expect(resolver.mock.calls[0]?.[0].aborted).toBe(true);
	});

	it("owns Back while resolving and cancels without releasing the route", async () => {
		const pin = vi.fn();
		const unpin = vi.fn();
		viewer = new ConversationMediaViewerState({ pin, unpin });
		const resolverSignals: AbortSignal[] = [];
		const opening = viewer.openExplicit({
			messageId: "album-message",
			opener: null,
			resolve: (signal) => {
				resolverSignals.push(signal);
				return new Promise((_, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				});
			},
		});

		expect(viewer.phase).toBe("resolving");
		expect(viewer.ownerCount).toBe(1);
		expect(backLayerManager.size).toBe(1);
		await expect(backLayerManager.handleBack()).resolves.toBe("handled");
		await expect(opening).resolves.toBe(false);

		expect(resolverSignals[0]?.aborted).toBe(true);
		expect(viewer.phase).toBe("closed");
		expect(viewer.ownerCount).toBe(0);
		expect(unpin).toHaveBeenCalledOnce();
		expect(backLayerManager.size).toBe(0);
		expect(
			reportViewerDiagnosticMock.mock.calls.map(([value]) => value.event),
		).toEqual(expect.arrayContaining(["resolving", "cancelled"]));
	});

	it("retains an authorization resolver across virtual row replacement", () => {
		viewer = new ConversationMediaViewerState();
		const create = vi.fn(() => ({ token: "resolver" }));

		const first = viewer.retainResolver("media-identity", create);
		const second = viewer.retainResolver("media-identity", create);

		expect(second).toBe(first);
		expect(create).toHaveBeenCalledOnce();
	});

	it("appends deck pages while preserving the selected stable media key", () => {
		viewer = new ConversationMediaViewerState();
		viewer.open({
			items: [
				{ id: "middle", kind: "image", url: "media://middle" },
				{ id: "newer", kind: "image", url: "media://newer" },
			],
			startId: "middle",
			messageId: "middle",
			opener: null,
		});

		viewer.updateItems([
			{ id: "older", kind: "image", url: "media://older" },
			{ id: "middle", kind: "image", url: "media://middle" },
			{ id: "newer", kind: "image", url: "media://newer" },
		]);

		expect(viewer.items.map((item) => item.id)).toEqual([
			"older",
			"middle",
			"newer",
		]);
		expect(viewer.startIndex).toBe(1);
	});
});
