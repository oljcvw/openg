import {
	createVideoCall,
	getVideoCallInfo,
	joinVideoCall,
	leaveVideoCall,
	renewVideoCall,
} from "$lib/api/video-call";
import { getDeveloperSettingsSnapshot } from "$lib/app-data/preferences.svelte";
import { reportClientDiagnostic } from "$lib/platform/client-diagnostics";
import { videoCallEvents } from "$lib/video-call/events";
import { nativeVideoCallBridge } from "$lib/video-call/native-bridge";
import type {
	VideoCallRenewal,
	VideoCallResult,
	VideoCallSession,
} from "$lib/api/video-call";
import type {
	IncomingVideoCall,
	VideoCallEnded,
	VideoCallEventSource,
} from "$lib/video-call/events";
import type { VideoCallNativeBridge } from "$lib/video-call/native-bridge";

const CONNECTED_CALL_LIMIT_SECONDS = 60;

export type VideoCallPhase =
	| "idle"
	| "incoming"
	| "starting"
	| "connecting"
	| "connected"
	| "ending"
	| "unavailable"
	| "error";

export type VideoCallSnapshot = {
	phase: VideoCallPhase;
	direction: "incoming" | "outgoing" | null;
	channelId: string | null;
	peerProfileId: number | null;
	peerLabel: string | null;
	remainingSeconds: number | null;
	result: VideoCallResult | null;
	errorMessage: string | null;
};

type VideoCallApi = {
	getInfo: typeof getVideoCallInfo;
	create: typeof createVideoCall;
	join: typeof joinVideoCall;
	leave: typeof leaveVideoCall;
	renew: typeof renewVideoCall;
};

type Clock = {
	now(): number;
	setInterval(handler: () => void, ms: number): ReturnType<typeof setInterval>;
	clearInterval(handle: ReturnType<typeof setInterval>): void;
	setTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimeout(handle: ReturnType<typeof setTimeout>): void;
};

const initialSnapshot: VideoCallSnapshot = {
	phase: "idle",
	direction: null,
	channelId: null,
	peerProfileId: null,
	peerLabel: null,
	remainingSeconds: null,
	result: null,
	errorMessage: null,
};

function resultMessage(
	result: VideoCallResult,
	message: string | null,
): string {
	if (message) return message;
	if (result === "ExceededLengthLimit")
		return "Daily video-call limit reached.";
	if (result === "TargetProfileUnavailable")
		return "This profile is unavailable for video calls.";
	return "Video call could not be started.";
}

export class VideoCallController {
	#snapshot: VideoCallSnapshot = initialSnapshot;
	#listeners = new Set<(snapshot: VideoCallSnapshot) => void>();
	#unlisteners: Promise<() => void>[] = [];
	#tickHandle: ReturnType<typeof setInterval> | null = null;
	#renewHandle: ReturnType<typeof setTimeout> | null = null;
	#connectedDeadline: number | null = null;
	#connectedLimitSeconds = CONNECTED_CALL_LIMIT_SECONDS;
	#started = false;

	constructor(
		private readonly api: VideoCallApi = {
			getInfo: getVideoCallInfo,
			create: createVideoCall,
			join: joinVideoCall,
			leave: leaveVideoCall,
			renew: renewVideoCall,
		},
		private readonly bridge: VideoCallNativeBridge = nativeVideoCallBridge,
		private readonly events: VideoCallEventSource = videoCallEvents,
		private readonly clock: Clock = {
			now: () => Date.now(),
			setInterval: (handler, ms) => setInterval(handler, ms),
			clearInterval: (handle) => clearInterval(handle),
			setTimeout: (handler, ms) => setTimeout(handler, ms),
			clearTimeout: (handle) => clearTimeout(handle),
		},
	) {}

	get snapshot(): VideoCallSnapshot {
		return this.#snapshot;
	}

	subscribe(listener: (snapshot: VideoCallSnapshot) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#snapshot);
		return () => this.#listeners.delete(listener);
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.#unlisteners = [
			this.events.onIncoming((call) => this.#onIncoming(call)),
			this.events.onEnded((call) => this.#onServerEnded(call)),
			this.bridge.onRemoteParticipantJoined(() => this.#onRemoteJoined()),
			this.bridge.onEnded(() => void this.#onNativeEnded()),
		];
	}

	async destroy(): Promise<void> {
		this.#started = false;
		this.#clearTimers();
		const channelId = this.#snapshot.channelId;
		const unlisteners = this.#unlisteners;
		this.#unlisteners = [];
		for (const unlisten of await Promise.all(unlisteners)) unlisten();
		if (channelId !== null) {
			await Promise.allSettled([this.bridge.stop(), this.api.leave(channelId)]);
		}
		this.#snapshot = initialSnapshot;
		this.#listeners.clear();
	}

	async startOutgoing({
		peerProfileId,
		peerLabel,
	}: {
		peerProfileId: number;
		peerLabel?: string | null;
	}): Promise<void> {
		if (this.#snapshot.phase !== "idle") return;
		this.#set({
			...initialSnapshot,
			phase: "starting",
			direction: "outgoing",
			peerProfileId,
			peerLabel: peerLabel ?? null,
		});
		try {
			const info = await this.api.getInfo();
			if (info.remainingSeconds === 0) {
				this.#failResult("ExceededLengthLimit", null);
				return;
			}
			const session = await this.api.create({ targetProfileId: peerProfileId });
			await this.#beginSession(session, "outgoing");
		} catch {
			this.#fail("Video call could not be started.");
		}
	}

	async acceptIncoming(): Promise<void> {
		if (
			this.#snapshot.phase !== "incoming" ||
			this.#snapshot.channelId === null
		)
			return;
		const { channelId, peerProfileId } = this.#snapshot;
		this.#set({ ...this.#snapshot, phase: "starting", errorMessage: null });
		try {
			const info = await this.api.getInfo();
			if (info.remainingSeconds === 0) {
				this.#failResult("ExceededLengthLimit", null);
				return;
			}
			const session = await this.api.join({
				channelId,
				remainingSeconds: info.remainingSeconds,
			});
			this.#set({ ...this.#snapshot, peerProfileId });
			await this.#beginSession(session, "incoming");
		} catch {
			this.#fail("Video call could not be joined.");
		}
	}

	async declineIncoming(): Promise<void> {
		if (
			this.#snapshot.phase !== "incoming" ||
			this.#snapshot.channelId === null
		)
			return;
		const channelId = this.#snapshot.channelId;
		this.#set({ ...this.#snapshot, phase: "ending" });
		try {
			await this.api.leave(channelId);
			this.dismiss();
		} catch {
			this.#fail("Video call could not be declined.");
		}
	}

	async end(): Promise<void> {
		const channelId = this.#snapshot.channelId;
		if (
			channelId === null ||
			!["connecting", "connected", "starting"].includes(this.#snapshot.phase)
		)
			return;
		this.#set({ ...this.#snapshot, phase: "ending" });
		this.#clearTimers();
		const results = await Promise.allSettled([
			this.bridge.stop(),
			this.api.leave(channelId),
		]);
		if (results.every((result) => result.status === "fulfilled")) {
			this.dismiss();
		} else {
			this.#fail("Video call ended, but cleanup was incomplete.");
		}
	}

	dismiss(): void {
		if (["connecting", "connected"].includes(this.#snapshot.phase)) return;
		this.#clearTimers();
		this.#set(initialSnapshot);
	}

	#onIncoming(call: IncomingVideoCall): void {
		if (this.#snapshot.phase !== "idle") {
			void this.api.leave(call.channelId).catch(() => undefined);
			return;
		}
		this.#set({
			...initialSnapshot,
			phase: "incoming",
			direction: "incoming",
			channelId: call.channelId,
			peerProfileId: call.senderId,
		});
	}

	#onServerEnded(call: VideoCallEnded): void {
		if (call.channelId !== this.#snapshot.channelId) return;
		this.#clearTimers();
		void this.bridge.stop().catch(() => undefined);
		this.#set(initialSnapshot);
	}

	async #beginSession(
		session: VideoCallSession,
		direction: "incoming" | "outgoing",
	): Promise<void> {
		if (session.result !== "Success") {
			if (session.channelId !== null)
				await this.api.leave(session.channelId).catch(() => undefined);
			this.#failResult(session.result, session.message);
			return;
		}
		if (session.channelId === null || session.token === null) {
			if (session.channelId !== null)
				await this.api.leave(session.channelId).catch(() => undefined);
			this.#fail("Video call response was incomplete.");
			return;
		}
		this.#connectedLimitSeconds = Math.min(
			CONNECTED_CALL_LIMIT_SECONDS,
			session.remainingSeconds,
		);
		if (this.#connectedLimitSeconds <= 0) {
			await this.api.leave(session.channelId).catch(() => undefined);
			this.#failResult("ExceededLengthLimit", session.message);
			return;
		}
		if (!(await this.bridge.isAvailable())) {
			await this.api.leave(session.channelId).catch(() => undefined);
			this.#set({
				...this.#snapshot,
				phase: "unavailable",
				channelId: null,
				remainingSeconds: null,
				errorMessage: "Video calls are not available in this build.",
			});
			return;
		}
		this.#set({
			...this.#snapshot,
			phase: "connecting",
			direction,
			channelId: session.channelId,
			remainingSeconds: this.#connectedLimitSeconds,
			result: "Success",
			errorMessage: null,
		});
		void this.#startNativeCall({
			channelId: session.channelId,
			token: session.token,
			direction,
		});
		this.#scheduleRenewal(session.refreshSeconds);
	}

	async #startNativeCall({
		channelId,
		token,
		direction,
	}: {
		channelId: string;
		token: string;
		direction: "incoming" | "outgoing";
	}): Promise<void> {
		try {
			await this.bridge.start({
				channelId,
				token,
				direction,
				connectedLimitSeconds: this.#connectedLimitSeconds,
			});
		} catch {
			if (
				this.#snapshot.channelId !== channelId ||
				!["connecting", "connected"].includes(this.#snapshot.phase)
			)
				return;
			await this.api.leave(channelId).catch(() => undefined);
			this.#fail("Video-call camera service is unavailable.");
		}
	}

	async #onNativeEnded(): Promise<void> {
		const channelId = this.#snapshot.channelId;
		if (
			channelId === null ||
			!["connecting", "connected"].includes(this.#snapshot.phase)
		)
			return;
		this.#clearTimers();
		this.#set({ ...this.#snapshot, phase: "ending" });
		try {
			await this.api.leave(channelId);
			this.dismiss();
		} catch {
			this.#fail("Video call ended, but cleanup was incomplete.");
		}
	}

	#onRemoteJoined(): void {
		if (this.#snapshot.phase !== "connecting") return;
		this.#connectedDeadline =
			this.clock.now() + this.#connectedLimitSeconds * 1000;
		this.#set({
			...this.#snapshot,
			phase: "connected",
			remainingSeconds: this.#connectedLimitSeconds,
		});
		this.#tickHandle = this.clock.setInterval(() => this.#tick(), 250);
	}

	#tick(): void {
		if (
			this.#snapshot.phase !== "connected" ||
			this.#connectedDeadline === null
		)
			return;
		const remainingSeconds = Math.max(
			0,
			Math.ceil((this.#connectedDeadline - this.clock.now()) / 1000),
		);
		if (remainingSeconds !== this.#snapshot.remainingSeconds) {
			this.#set({ ...this.#snapshot, remainingSeconds });
		}
		if (remainingSeconds === 0) void this.end();
	}

	#scheduleRenewal(refreshSeconds: number): void {
		if (refreshSeconds <= 0) return;
		if (this.#renewHandle !== null) this.clock.clearTimeout(this.#renewHandle);
		this.#renewHandle = this.clock.setTimeout(
			() => void this.#renew(),
			refreshSeconds * 1000,
		);
	}

	async #renew(): Promise<void> {
		this.#renewHandle = null;
		if (!["connecting", "connected"].includes(this.#snapshot.phase)) return;
		try {
			const renewal = await this.api.renew();
			await this.#applyRenewal(renewal);
		} catch {
			await this.end();
		}
	}

	async #applyRenewal(renewal: VideoCallRenewal): Promise<void> {
		if (renewal.result !== "Success" || renewal.token === null) {
			await this.end();
			return;
		}
		await this.bridge.renewToken(renewal.token);
		const serverLimit = Math.min(
			CONNECTED_CALL_LIMIT_SECONDS,
			renewal.remainingSeconds,
		);
		if (this.#snapshot.phase === "connected") {
			const serverDeadline = this.clock.now() + serverLimit * 1000;
			this.#connectedDeadline = Math.min(
				this.#connectedDeadline ?? serverDeadline,
				serverDeadline,
			);
		} else {
			this.#connectedLimitSeconds = Math.min(
				this.#connectedLimitSeconds,
				serverLimit,
			);
			this.#set({
				...this.#snapshot,
				remainingSeconds: this.#connectedLimitSeconds,
			});
		}
		this.#scheduleRenewal(renewal.refreshSeconds);
	}

	#failResult(result: VideoCallResult, message: string | null): void {
		this.#clearTimers();
		this.#set({
			...this.#snapshot,
			phase: "error",
			channelId: null,
			remainingSeconds: null,
			result,
			errorMessage: resultMessage(result, message),
		});
	}

	#fail(message: string): void {
		this.#clearTimers();
		this.#set({
			...this.#snapshot,
			phase: "error",
			channelId: null,
			remainingSeconds: null,
			result: "Error",
			errorMessage: message,
		});
	}

	#clearTimers(): void {
		if (this.#tickHandle !== null) this.clock.clearInterval(this.#tickHandle);
		if (this.#renewHandle !== null) this.clock.clearTimeout(this.#renewHandle);
		this.#tickHandle = null;
		this.#renewHandle = null;
		this.#connectedDeadline = null;
	}

	#set(snapshot: VideoCallSnapshot): void {
		if (snapshot.phase !== this.#snapshot.phase) {
			const level =
				snapshot.phase === "error"
					? "error"
					: snapshot.phase === "unavailable"
						? "warning"
						: "info";
			if (level !== "info" || getDeveloperSettingsSnapshot().mediaDiagnostics) {
				reportClientDiagnostic({
					category: "media_workflow",
					component: "video_call",
					code: `phase_${snapshot.phase}`,
					level,
				});
			}
		}
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener(snapshot);
	}
}

export const videoCallController = new VideoCallController();
