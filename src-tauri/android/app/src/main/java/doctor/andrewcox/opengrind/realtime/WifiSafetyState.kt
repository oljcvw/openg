package doctor.andrewcox.opengrind.realtime

internal data class WifiSafetyValue(
	val known: Boolean,
	val connected: Boolean,
)

internal fun shouldBlockLocationWifiBackgroundTraffic(
	manualLocationActive: Boolean,
	known: Boolean,
	connected: Boolean,
): Boolean = manualLocationActive && (!known || connected)

internal class WifiSafetyState<T> {
	private var currentNetwork: T? = null
	private var value: WifiSafetyValue? = null

	fun observed(network: T, connected: Boolean): WifiSafetyValue? {
		currentNetwork = network
		return setValue(known = true, connected = connected)
	}

	fun announced(network: T): WifiSafetyValue? {
		currentNetwork = network
		return setValue(known = false, connected = false)
	}

	fun capabilities(network: T, connected: Boolean): WifiSafetyValue? {
		if (currentNetwork != network) return null
		return setValue(known = true, connected = connected)
	}

	fun lost(network: T): WifiSafetyValue? {
		if (currentNetwork != network) return null
		currentNetwork = null
		return setValue(known = true, connected = false)
	}

	fun unavailable(known: Boolean): WifiSafetyValue? {
		currentNetwork = null
		return setValue(known = known, connected = false)
	}

	private fun setValue(known: Boolean, connected: Boolean): WifiSafetyValue? {
		val next = WifiSafetyValue(known, known && connected)
		if (value == next) return null
		value = next
		return next
	}
}
