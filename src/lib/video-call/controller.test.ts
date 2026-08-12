import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/ws.svelte", async () => {
	const { default: z } = await import("zod");
	return {
		notificationEventSchema: z.object({
			type: z.string(),
			notificationId: z.string().nullable(),
			ref: z.string().nullable(),
			payload: z.unknown(),
		}),
		ws: { on: vi.fn() },
	};
});

import { VideoCallController } from "$lib/video-call/controller";
import type { IncomingVideoCall, VideoCallEnded } from "$lib/video-call/events";

function successfulSession(overrides: Record<string, unknown> = {}) {
	return {
		result: "Success" as const,
		channelId: "channel",
		token: "token",
		remainingSeconds: 120,
		refreshSeconds: 0,
		message: null,
		...overrides,
	};
}

function setup(options: { nativeAvailable?: boolean } = {}) {
	let incomingHandler: ((call: IncomingVideoCall) => void) | null = null;
	let endedHandler: ((call: VideoCallEnded) => void) | null = null;
	let remoteJoinedHandler: (() => void) | null = null;
	let nativeEndedHandler: (() => void) | null = null;
	const api = {
		getInfo: vi.fn().mockResolvedValue({ remainingSeconds: 120 }),
		create: vi.fn().mockResolvedValue(successfulSession()),
		join: vi.fn().mockResolvedValue(successfulSession()),
		leave: vi.fn().mockResolvedValue(undefined),
		renew: vi.fn().mockResolvedValue({
			result: "Success" as const,
			token: "renewed-token",
			remainingSeconds: 120,
			refreshSeconds: 0,
			message: null,
		}),
	};
	const bridge = {
		isAvailable: vi.fn().mockResolvedValue(options.nativeAvailable ?? true),
		start: vi.fn().mockResolvedValue(undefined),
		renewToken: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		onRemoteParticipantJoined: vi.fn((handler: () => void) => {
			remoteJoinedHandler = handler;
			return Promise.resolve(() => undefined);
		}),
		onEnded: vi.fn((handler: () => void) => {
			nativeEndedHandler = handler;
			return Promise.resolve(() => undefined);
		}),
	};
	const events = {
		onIncoming: vi.fn((handler: (call: IncomingVideoCall) => void) => {
			incomingHandler = handler;
			return Promise.resolve(() => undefined);
		}),
		onEnded: vi.fn((handler: (call: VideoCallEnded) => void) => {
			endedHandler = handler;
			return Promise.resolve(() => undefined);
		}),
	};
	const controller = new VideoCallController(api, bridge, events);
	controller.start();
	return {
		api,
		bridge,
		controller,
		incoming(call: IncomingVideoCall) {
			if (incomingHandler === null) throw new Error("Incoming handler missing");
			incomingHandler(call);
		},
		ended(call: VideoCallEnded) {
			if (endedHandler === null) throw new Error("Ended handler missing");
			endedHandler(call);
		},
		remoteJoined() {
			if (remoteJoinedHandler === null)
				throw new Error("Remote participant handler missing");
			remoteJoinedHandler();
		},
		nativeEnded() {
			if (nativeEndedHandler === null)
				throw new Error("Native ended handler missing");
			nativeEndedHandler();
		},
	};
}

describe("VideoCallController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
	});

	afterEach(() => vi.useRealTimers());

	it("starts the connected countdown only after remote participation", async () => {
		const harness = setup();

		await harness.controller.startOutgoing({
			peerProfileId: 42,
			peerLabel: "Alex",
		});

		expect(harness.controller.snapshot).toMatchObject({
			phase: "connecting",
			remainingSeconds: 60,
			peerProfileId: 42,
		});
		await vi.advanceTimersByTimeAsync(10_000);
		expect(harness.controller.snapshot.remainingSeconds).toBe(60);

		harness.remoteJoined();
		await vi.advanceTimersByTimeAsync(1_100);
		expect(harness.controller.snapshot).toMatchObject({
			phase: "connected",
			remainingSeconds: 59,
		});
		expect(harness.bridge.start).toHaveBeenCalledWith({
			channelId: "channel",
			token: "token",
			direction: "outgoing",
			connectedLimitSeconds: 60,
		});
	});

	it("handles remote participation emitted while native startup resolves", async () => {
		const harness = setup();
		harness.bridge.start.mockImplementationOnce(() => {
			harness.remoteJoined();
			return Promise.resolve();
		});

		await harness.controller.startOutgoing({ peerProfileId: 42 });

		expect(harness.controller.snapshot.phase).toBe("connected");
		expect(harness.controller.snapshot.remainingSeconds).toBe(60);
	});

	it("accepts a foreground incoming call through the join endpoint", async () => {
		const harness = setup();
		harness.incoming({ channelId: "incoming-channel", senderId: 77 });

		expect(harness.controller.snapshot).toMatchObject({
			phase: "incoming",
			peerProfileId: 77,
		});
		await harness.controller.acceptIncoming();

		expect(harness.api.join).toHaveBeenCalledWith({
			channelId: "incoming-channel",
			remainingSeconds: 120,
		});
		expect(harness.bridge.start).toHaveBeenCalledWith(
			expect.objectContaining({ direction: "incoming" }),
		);
		expect(harness.controller.snapshot.phase).toBe("connecting");
	});

	it("declines an incoming call without creating local history", async () => {
		const harness = setup();
		harness.incoming({ channelId: "incoming-channel", senderId: 77 });

		await harness.controller.declineIncoming();

		expect(harness.api.leave).toHaveBeenCalledWith("incoming-channel");
		expect(harness.controller.snapshot.phase).toBe("idle");
		expect(harness.api.create).not.toHaveBeenCalled();
	});

	it("reports a graceful unavailable state when native calling is absent", async () => {
		const harness = setup({ nativeAvailable: false });

		await harness.controller.startOutgoing({ peerProfileId: 42 });

		expect(harness.controller.snapshot).toMatchObject({
			phase: "unavailable",
			errorMessage: "Video calls are not available in this build.",
		});
		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.bridge.start).not.toHaveBeenCalled();
	});

	it("surfaces native startup failure after the command rejects", async () => {
		const harness = setup();
		harness.bridge.start.mockRejectedValueOnce(new Error("native unavailable"));

		await harness.controller.startOutgoing({ peerProfileId: 42 });
		await vi.waitFor(() =>
			expect(harness.controller.snapshot.phase).toBe("error"),
		);

		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.controller.snapshot.errorMessage).toBe(
			"Video-call camera service is unavailable.",
		);
	});

	it.each([
		"Error",
		"ExceededLengthLimit",
		"TargetProfileUnavailable",
	] as const)("surfaces %s create result", async (result) => {
		const harness = setup();
		harness.api.create.mockResolvedValue(successfulSession({ result }));

		await harness.controller.startOutgoing({ peerProfileId: 42 });

		expect(harness.controller.snapshot).toMatchObject({
			phase: "error",
			result,
		});
		expect(harness.api.leave).toHaveBeenCalledWith("channel");
	});

	it("cleans up an incomplete successful server response", async () => {
		const harness = setup();
		harness.api.create.mockResolvedValue(successfulSession({ token: null }));

		await harness.controller.startOutgoing({ peerProfileId: 42 });

		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.controller.snapshot).toMatchObject({
			phase: "error",
			errorMessage: "Video call response was incomplete.",
		});
	});

	it("ends only the matching channel on server completion", async () => {
		const harness = setup();
		await harness.controller.startOutgoing({ peerProfileId: 42 });

		harness.ended({ channelId: "other", duration: 3, result: "Cancelled" });
		expect(harness.controller.snapshot.phase).toBe("connecting");

		harness.ended({ channelId: "channel", duration: 3, result: "Cancelled" });
		expect(harness.controller.snapshot.phase).toBe("idle");
		expect(harness.bridge.stop).toHaveBeenCalledOnce();
	});

	it("leaves the server call after native UI ends", async () => {
		const harness = setup();
		await harness.controller.startOutgoing({ peerProfileId: 42 });

		harness.nativeEnded();
		await vi.waitFor(() =>
			expect(harness.controller.snapshot.phase).toBe("idle"),
		);

		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.bridge.stop).not.toHaveBeenCalled();
	});

	it("leaves when the connected product cap expires", async () => {
		const harness = setup();
		harness.api.create.mockResolvedValue(
			successfulSession({ remainingSeconds: 2 }),
		);
		await harness.controller.startOutgoing({ peerProfileId: 42 });
		harness.remoteJoined();

		await vi.advanceTimersByTimeAsync(2_100);

		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.bridge.stop).toHaveBeenCalledOnce();
		expect(harness.controller.snapshot.phase).toBe("idle");
	});

	it("renews the native token at the server refresh cadence", async () => {
		const harness = setup();
		harness.api.create.mockResolvedValue(
			successfulSession({ refreshSeconds: 5 }),
		);
		await harness.controller.startOutgoing({ peerProfileId: 42 });
		harness.remoteJoined();

		await vi.advanceTimersByTimeAsync(5_100);

		expect(harness.api.renew).toHaveBeenCalledOnce();
		expect(harness.bridge.renewToken).toHaveBeenCalledWith("renewed-token");
	});

	it("cleans up an active call when the foreground host is destroyed", async () => {
		const harness = setup();
		await harness.controller.startOutgoing({ peerProfileId: 42 });

		await harness.controller.destroy();

		expect(harness.bridge.stop).toHaveBeenCalledOnce();
		expect(harness.api.leave).toHaveBeenCalledWith("channel");
		expect(harness.controller.snapshot.phase).toBe("idle");
	});
});
