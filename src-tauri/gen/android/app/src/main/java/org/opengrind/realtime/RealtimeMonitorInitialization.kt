package org.opengrind.realtime

internal class RealtimeMonitorInitialization {
	private var initialized = false

	fun runOnce(registration: () -> Unit): Boolean {
		synchronized(this) {
			if (initialized) return false
			initialized = true
		}

		try {
			registration()
		} catch (error: RuntimeException) {
			synchronized(this) { initialized = false }
			throw error
		}
		return true
	}
}
