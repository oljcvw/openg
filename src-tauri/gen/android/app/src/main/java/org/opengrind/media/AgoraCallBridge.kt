package org.opengrind.media

import java.lang.ref.WeakReference

internal object AgoraCallBridge {
	interface Listener {
		fun onRemoteUserJoined(uid: Int)
		fun onEnded(reason: String, durationMs: Long)
	}

	@Volatile var listener: Listener? = null
	@Volatile private var activity = WeakReference<AgoraVideoCallActivity>(null)
	@Volatile private var launchPending = false
	@Volatile private var stopPending = false

	@Synchronized
	fun reserveLaunch(): Boolean {
		if (launchPending || activity.get() != null) return false
		launchPending = true
		stopPending = false
		return true
	}

	@Synchronized
	fun cancelLaunch() {
		launchPending = false
		stopPending = false
	}

	@Synchronized
	fun attach(next: AgoraVideoCallActivity): Boolean {
		launchPending = false
		if (stopPending) {
			stopPending = false
			return false
		}
		activity = WeakReference(next)
		return true
	}

	@Synchronized
	fun detach(current: AgoraVideoCallActivity) {
		if (activity.get() === current) activity.clear()
	}

	fun isActive(): Boolean = launchPending || activity.get() != null
	fun renewToken(token: String): Boolean = activity.get()?.renewToken(token) ?: false

	@Synchronized
	fun stop(): Boolean {
		activity.get()?.let { return it.requestStop("local-ended") }
		if (!launchPending) return false
		stopPending = true
		return true
	}

	fun remoteUserJoined(uid: Int) = listener?.onRemoteUserJoined(uid)
	fun ended(reason: String, durationMs: Long) = listener?.onEnded(reason, durationMs)
}
